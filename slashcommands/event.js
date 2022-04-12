const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const moment = require('moment-timezone');
const tz = require('../extras/timezones');
const { promptForMessage, promptYesNo, getConfig } = require('../extras/common.js');

let eventInfoChannel = null;

const DEFAULT_EVENT_DATA = {
  guildDefaultTimeZones: {},
  events: {},
  userTimeZones: {},
  finishedRoles: [],
  eventInfoMessage: {},
};

// Events that finished more than this time ago will have their roles deleted
const EVENT_CLEANUP_PERIOD = moment.duration(7, 'days');

async function prepTables(botdb) {
  await Promise.all([
    botdb.run(`CREATE TABLE IF NOT EXISTS event_data (
      event_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      role_id TEXT,
      timezone TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      organizer_id TEXT NOT NULL,
      attendance_options TEXT NOT NULL,
      recurrence_period INTEGER,
      recurrence_count INTEGER
      )`),
    botdb.run(`CREATE TABLE IF NOT EXISTS event_posts (
      message_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      attendance_status TEXT NOT NULL
    )`),
    botdb.run(`CREATE TABLE IF NOT EXISTS event_members (
      event_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      attendance_status TEXT NOT NULL
    )`),
    botdb.run(`CREATE TABLE IF NOT EXISTS event_roles (
      event_id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      autodelete TEXT NOT NULL
    )`),
  ]);
}


class Event {
  /**
   * @param {string} name
   * @param {Discord.Channel} channel
   * @param {string} timezone
   * @param {Date} start
   * @param {number} duration
   * @param {Discord.GuildMember} organizer
   * @param {Array} attendanceOptions
   * @param {string} recurrencePeriod
   * @param {number} recurrenceCount
   * @param {Discord.Role} role
   * @param {boolean} autoDelete
   * @param {Discord.Collection(postID, Discord.Message)} posts
   * @param {Discord.Collection(memberID, Discord.GuildMember)} attendees
   */
  constructor(name, id, channel, timezone, start, duration, organizer, attendanceOptions, recurrencePeriod, recurrenceCount, role, autoDelete, posts, attendees) {
    this.name = name;
    this.id = id;
    this.channel = channel;
    this.timezone = timezone;
    this.start = start;
    this.duration = duration;
    this.organizer = organizer;
    this.attendanceOptions = attendanceOptions;
    this.recurrencePeriod = recurrencePeriod;
    this.recurrenceCount = recurrenceCount;
    this.role = role;
    this.role.autoDelete = autoDelete;
    this.posts = posts;
    this.attendees = attendees;
  }
}

class EventManager {
  /**
   * Create a new EventManager instance.
   *
   * @param client Discord client instance
   */
  constructor(client) {
    this.client = client;
    this.timer = null;
    this.upcomingEvents = {};
    this.rolesPendingPrune = [];
    this.timeZoneInfoMessage = {};
    this.eventInfoMessage = {};
  }

  /**
   * Load the state of the EventManager from the database into a client var.
   * TODO SQLify
   */
  async loadState(client, botdb) {
    client.eventData = new Discord.Collection();
    // extract data from botdb and input it into client.eventData programmatically.
    for (const guild of await client.guilds.fetch()) {
      const config = getConfig(client, guild.id);
      const guildData = {
        events: new Discord.Collection(),
        finishedRoles: [],
      };
      // TODO: get finished roles; use event_roles + event_data
      const eventDataArr = await botdb.all('SELECT * FROM event_data WHERE guild_id = ?', guild.id);
      if (eventDataArr) {
        // TODO: try/catch for if channel/member/role doesn't exist.
        // if memory usage is too much it might be ideal to wait to fetch these down the line.
        await Promise.all(eventDataArr.map(async e => {
          const eventRole = await botdb.get('SELECT * FROM event_roles WHERE event_id = ?', e.event_id);
          const channel = await client.channels.fetch(e.channel_id);
          const organizer = await guild.members.fetch(e.organizer_id);
          const role = await guild.roles.fetch(eventRole.role_id);
          const eventPosts = await botdb.all('SELECT * FROM event_posts WHERE event_id = ?', e.event_id);
          const posts = new Discord.Collection();
          eventPosts.forEach(async p => {
            const c = client.channels.fetch(p.channel_id);
            const m = c.messages.fetch(p.message_id);
            posts.set(m.id, m);
          });
          const eventAttendees = await botdb.all('SELECT * FROM event_members WHERE event_id =?', e.event_id);
          const attendees = new Discord.Collection();
          eventAttendees.forEach(async a => {
            const member = await guild.members.fetch(a.user_id);
            member.attendanceStatus = a.attendance_status;
          });
          const event = new Event(e.event_name, e.event_id, channel, e.timezone, Date(e.start_time), e.duration, organizer, JSON.parse(e.attendance_options), e.recurrence_period, e.recurrence_count, role, Boolean(eventRole.autodelete), posts, attendees);
          guildData.events.set(e.event_id, event);
        }));
        // TODO finished role handling
        // guildData.finishedRoles = [];
        // do we need this? Is there really a reason not to wipe the role immediately?
      }
      client.eventData.set(guild.id, guildData);
    }
  }

  /**
   * Save the state of the EventManager to the global JSON data.
   *
   * @returns {Promise<*>} Resolves when the data file has been written out.
   * TODO: support partial rewrites/single event rewrites
   */
  async saveState(client, botdb) {
    const promiseArr = [];
    client.eventData.forEach(async (guildData, guildId) => {
      guildData.events.forEach(async (event) => {
        // first, event_data table
        promiseArr.push(await botdb.run(
          `INSERT INTO event_data(event_id, guild_id, channel_id, timezone, name, start_time, duration, organizer_id, attendance_options, recurrence_period, recurrence_count)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET
            guild_id = excluded.guild_id,
            channel_id = excluded.channel_id,
            timezone = excluded.timezone,
            name = excluded.name,
            start_time = excluded.start_time,
            duration = excluded.duration,
            organizer_id = excluded.organizer_id,
            attendance_options = excluded.attendance_options,
            recurrence_period = excluded.recurrence_period,
            recurrence_count = excluded.recurrence_count`, event.id, guildId, event.channel.id, event.timezone, event.start.valueOf(), event.duration, event.organizer.id, JSON.stringify(event.attendanceOptions), event.recurrencePeriod, event.recurrenceCount));
        promiseArr.push(await botdb.run('INSERT INTO event_roles(event_id, role_id, autodelete) VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET role_id = excluded.role_id, autodelete = excluded.autodelete WHERE role_id!=excluded.role_id OR autodelete!=excluded.autodelete', event.id, event.role.id, event.role.autoDelete));
        event.posts.forEach(async (post) => {
          promiseArr.push(await botdb.run('INSERT OR IGNORE INTO event_posts(message_id, event_id, channel_id) VALUES(?,?,?)', post.id, event.id, post.channel.id));
        });
        event.attendees.forEach(async (member) => {
          promiseArr.push(await botdb.run('INSERT OR IGNORE INTO event_members(event_id, user_id, attendance_status'), event.id, member.id, member.attendanceStatus);
        });
      });
    });
    return Promise.all(promiseArr);
  }

  /**
   * Start running the timer for recurring EventManager tasks.
   */
  start() {
    // Tick immediately at start to do cleanup
    this.tick().then(() => {
      // Ensure we're always at (or close to) the 'top' of a minute when we run our tick
      const topOfMinute = 60000 - (Date.now() % 60000);
      this.timer = setTimeout(() => {
        this.timer = setInterval(() => this.tick(), 60000);
        this.tick();
      }, topOfMinute);
    });

    /*
    * TODO: Time zones only need to be queried at event instantiation
    * REMOVE TZ post and move to the setup loop.
    // update time zone posts in case list of time zones has changed.
    this.client.guilds.cache.forEach((g) => {
      const config = getConfig(g.client, g.id);
      if (config.eventInfoChannelId) {
        this.updateTZPost(g.id);
      }
    }); */

  }

  /**
   * Perform a single run of the checks for pending scheduled tasks.
   *
   * @returns {Promise<void>} Resolves when the work for this tick is finished.
   */
  async tick() {
    const now = moment.utc();
    const eventsByGuild = Object.entries(this.upcomingEvents);

    for (const [guild, events] of eventsByGuild) {
      const dueEvents = events.filter((event) => event.due.isSameOrBefore(now));
      this.upcomingEvents[guild] = events.filter((event) =>
        event.due.isAfter(now),
      );
      this.rolesPendingPrune = [
        ...this.rolesPendingPrune,
        ...dueEvents.map((event) => ({
          startedAt: event.due,
          guild: event.guild,
          role: event.role,
        })),
      ];
      await this.saveState();

      if (dueEvents.length > 0) {
        for (const event of dueEvents) {
          const guild = this.client.guilds.cache.get(event.guild);
          const eventAge = moment.duration(now.diff(event.due));
          // Discard events we missed for more than 5 minutes
          if (eventAge.asMinutes() >= 5) {
            break;
          }
          const destChannel = await this.client.channels.fetch(event.channel);
          if (!destChannel) {
            console.log('Got event for unknown channel', event.channel);
            break;
          }

          await destChannel.send(
            `The event **'${event.name}'** is starting now! <@&${event.role}>`, { embeds: [embedEvent(event, guild, { title: event.name, description: 'This event is starting now.' })],
            },
          );
        }
      }

      // Post/update the event info message if necessary
      if (
        dueEvents.length > 0 ||
        (eventInfoChannel && !this.eventInfoMessage[guild])
      ) {
        await this.updateUpcomingEventsPost(guild);
      }
    }

    const rolesToPrune = this.rolesPendingPrune.filter(
      (role) => now.diff(role.startedAt) > EVENT_CLEANUP_PERIOD,
    );
    this.rolesPendingPrune = this.rolesPendingPrune.filter(
      (role) => now.diff(role.startedAt) <= EVENT_CLEANUP_PERIOD,
    );
    await this.saveState();

    for (const roleInfo of rolesToPrune) {
      const guild = this.client.guilds.cache.get(roleInfo.guild);
      const role = guild.roles.cache.get(roleInfo.role);
      if (role) {
        await role.delete(
          `Role removed as event happened ${EVENT_CLEANUP_PERIOD.humanize()} ago`,
        );
      }
      else {
        console.log(
          `Skipping removal of role ${roleInfo.role} from guild ${roleInfo.guild} as it no longer exists`,
        );
      }
    }
  }

  /**
   * Stop running the EventManager timer.
   */
  stop() {
    this.client.clearTimeout(this.timer);
    this.client.clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Add a new event to the EventManager.
   *
   * @param event The data for the event.
   * @returns {Promise<*>} Resolves once the event has been saved persistently.
   */
  async add(event) {
    const guild = event.guild;
    if (!this.upcomingEvents[guild]) {
      this.upcomingEvents[guild] = [];
    }
    this.upcomingEvents[guild].push(event);
    this.upcomingEvents[guild].sort((a, b) => a.due.diff(b.due));
    await this.updateUpcomingEventsPost(guild);
    return this.saveState();
  }

  _indexByName(guild, eventName) {
    const lowerEventName = eventName.toLowerCase();
    if (!this.upcomingEvents[guild]) {
      return undefined;
    }

    const index = this.upcomingEvents[guild].findIndex(
      (event) => event.name.toLowerCase() === lowerEventName,
    );

    return index !== -1 ? index : undefined;
  }

  /**
   * Get the event with this name on a specific guild.
   *
   * @param guildId The Snowflake corresponding to the event's guild
   * @param eventName The name of the event to retrieve
   * @returns Event data or undefined
   */
  getByName(guildId, eventName) {
    const index = this._indexByName(guildId, eventName);
    return index !== undefined ? this.upcomingEvents[guildId][index] : index;
  }

  /**
   * Update the event data for a named event on a specific guild
   *
   * @param guildId The Snowflake corresponding to the event's guild
   * @param eventName The name of the event to retrieve
   * @param event The new event data
   * @returns {Promise<boolean>} Resolves with whether the event was updated
   */
  async updateByName(guildId, eventName, event) {
    const index = this._indexByName(guildId, eventName);
    if (index === undefined) {
      return false;
    }

    this.upcomingEvents[guildId][index] = event;
    await this.saveState();
    return true;
  }

  /**
   * Delete a named event on a specific guild
   *
   * @param guildId The Snowflake corresponding to the event's guild
   * @param eventName The name of the event to retrieve
   * @returns {Promise<boolean>} Resolves with whether the event was delete
   */
  async deleteByName(guildId, eventName) {
    const index = this._indexByName(guildId, eventName);
    if (index === undefined) {
      return false;
    }

    this.upcomingEvents[guildId].splice(index, 1);
    await this.updateUpcomingEventsPost(guildId);
    await this.saveState();
    return true;
  }

  /**
   * Get the active events for a specified guild.
   *
   * @param guild Snowflake of the Guild to scope events to.
   * @returns Array of events for guild.
   */
  guildEvents(guild) {
    return this.upcomingEvents[guild] || [];
  }

  /**
   * Adds a participant to an event.
   *
   * @param guildId Snowflake of the Guild to scope events to.
   * @param userId Snowflake of the User to be added to the event.
   * @param eventName Name of the event to be updated.
   * @returns {boolean} Whether the user was added to the event (false if already added).
   */
  async addParticipant(guildId, userId, eventName) {
    const event = this.getByName(guildId, eventName);
    if (!event) {
      return false;
    }

    const guild = this.client.guilds.cache.get(guildId);
    const member = guild.members.cache.get(userId);
    await member.roles.add(event.role, 'Requested to be added to this event');

    return true;
  }

  /**
   * Removes a participant from an event.
   *
   * @param guildId Snowflake of the Guild to scope events to.
   * @param userId Snowflake of the User to be removed to the event.
   * @param eventName Name of the event to be updated.
   * @returns {boolean} Whether the user was removed from the event (false if not already added).
   */
  async removeParticipant(guildId, userId, eventName) {
    const event = this.getByName(guildId, eventName);
    if (!event) {
      return false;
    }

    const guild = this.client.guilds.cache.get(guildId);
    const member = guild.members.cache.get(userId);
    await member.roles.remove(
      event.role,
      'Requested to be removed from this event',
    );

    return true;
  }

  /**
   * Updates the guild's time zone post. Only runs at start, in case any time zones have been added.
   *
   * @param guildId Snowflake of the Guild to update the event post for
   * @returns {Promise<void>} Resolves when post update complete.
   *
   * TODO revamp time zone management

  async updateTZPost(guildId) {
    const client = this.client;
    const config = getConfig(client, guildId);
    const guild = this.client.guilds.cache.get(guildId);
    const tzMessage = this.timeZoneInfoMessage[guildId];

    const tzTemplateParams = {
      tzlist: tz.LOCAL_TIMEZONES.map(({ name, abbr, dstAbbr }) => {
        // Show DST and standard abbreviation together, where needed
        const tzAbbrs = dstAbbr ? `${abbr}/${dstAbbr}` : abbr;

        return `${tzAbbrs} - ${name}`;
      }).join('\n'),
    };

    if (eventInfoChannel) {
      if (!guild.channels.cache.has(eventInfoChannel.id)) {
        return;
      }
    }

    if (tzMessage) {
      console.log('found time zone message', tzMessage.id);
      await tzMessage.edit(TZ_MESSAGE_TEMPLATE(tzTemplateParams, config));
    }
    else {
      console.log(
        `No time zone info message found for guild ${guildId}, send a new one.`,
      );
      const newMessage = await eventInfoChannel.send(
        TZ_MESSAGE_TEMPLATE(tzTemplateParams, config),
      );
      this.timeZoneInfoMessage[guildId] = newMessage;
      await this.saveState();
    }
  }*/

  /**
   * Updates the guild's post for upcoming event if applicable.
   *
   * @param guildId Snowflake of the Guild to update the event post for
   * @returns {Promise<void>} Resolves when post update complete.
   */
  async updateUpcomingEventsPost(guildId) {
    const guild = this.client.guilds.cache.get(guildId);
    const config = getConfig(this.client, guild.id);
    const events = this.guildEvents(guildId);
    const message = this.eventInfoMessage[guildId];
    const defaultTimeZone = getGuildTimeZone(guild);

    const upcomingEventsInfoText = events.map((event) =>
      EVENT_INFO_TEMPLATE({ ...event, due: event.due.tz(defaultTimeZone), config: config }),
    );

    const templateParams = {
      events:
        upcomingEventsInfoText.length > 0
          ? upcomingEventsInfoText.join('\n')
          : 'No upcoming events.',
      prefix: config.prefix,
    };

    if (eventInfoChannel) {
      // We only support one eventinfochannel for now
      if (!guild.channels.cache.has(eventInfoChannel.id)) {
        console.log(`No event info channel for guild ${guildId}, skip.`);
        return;
      }

      if (message) {
        console.log('Updating events message ', message.id);
        await message.edit(EVENT_MESSAGE_TEMPLATE(templateParams));
        await message.channel.send('.').then((msg) => {
          msg.delete({ timeout: 100 });
        });
        // await message.delete();
        // global.eventData.guildDefaultTimeZones[guild.id];
      }
      else {
        console.log(
          `No event info message found for guild ${guildId}, send a new one.`,
        );
        const newMessage = await eventInfoChannel.send(
          EVENT_MESSAGE_TEMPLATE(templateParams),
        );
        this.eventInfoMessage[guildId] = newMessage;
        await this.saveState();
      }
    }
  }
}

let eventManager;

// currently does nothing.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create or manage events')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('create an event'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('edit an event'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('cancel')
        .setDescription('cancel an event')),
  async execute(interaction, botdb) {
    const subCommand = interaction.options.getSubcommand();
    switch(subCommand) {
    case 'create':
      interaction.reply('create');
      break;
    case 'edit':
      interaction.reply('edit');
      break;
    case 'cancel':
      interaction.reply('cancel');
      break;
    }
    botdb;
  },
  async init(client, botdb) {
    // prep the necessary tables in the db.
    await prepTables(botdb);
    // Ensure the client is ready so that event catch-up doesn't fail
    // due to not knowing about the channel.
    const onReady = () => {
      if (eventInfoChannel !== null) return eventInfoChannel;
      client.guilds.cache.forEach((g) => {
        const config = getConfig(client, g.id);
        if (!config.eventInfoChannelId) {
          console.log(`No event info channel set for ${g.id}, skipping.`);
        }
        else {
          console.log(
            `Retrieving event info channel for ${g.id}: ${config.eventInfoChannelId}`,
          );
          eventInfoChannel =
          client.channels.cache.get(config.eventInfoChannelId) || null;

          if (eventInfoChannel) {
            console.log('Event info channel set.');
          }
          else {
            console.log(
              `Event info channel ${config.eventInfoChannelId} could not be found.`,
            );
          }
        }
      });
      eventManager = new EventManager(client);
      eventManager.loadState(client, botdb).then(() => {
        eventManager.start();
        console.log('Event manager ready.');
      });
    };

    if (client.status !== Discord.Constants.Status.READY) {
      client.on('ready', onReady);
    }
    else {
      onReady();
    }
  },
};
