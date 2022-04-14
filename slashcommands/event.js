const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const moment = require('moment-timezone');
// const tz = require('../extras/timezones');
const { promptForMessage, promptYesNo, getUserPermLevel, getConfig } = require('../extras/common.js');
const { performance } = require('perf_hooks');

// let eventInfoChannel = null;

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
   * @param {moment() date} start
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
  constructor(name, id, channel, timezone, start, duration, organizer, attendanceOptions, recurrencePeriod, recurrenceCount, role, posts, attendees) {
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
  constructor(client, botdb) {
    this.botdb = botdb;
    this.client = client;
    this.timer = null;
    this.dueEvents = new Discord.Collection();
    this.rolesPendingPrune = new Discord.Collection();
  }

  /**
   * Load the state of the EventManager from the database into a client var.
   * TODO SQLify
   */
  async loadState() {
    this.client.eventData = new Discord.Collection();
    // extract data from botdb and input it into client.eventData programmatically.
    for (const [, guild] of await this.client.guilds.fetch()) {
      // TODO: get event posts channel and update it
      // const config = getConfig(this.client, guild.id);
      const guildData = {
        events: new Discord.Collection(),
      };
      // TODO: get finished roles; use event_roles + event_data
      const eventDataArr = await this.botdb.all('SELECT * FROM event_data WHERE guild_id = ?', guild.id);
      if (eventDataArr) {
        // TODO: try/catch for if channel/member/role doesn't exist.
        // if memory usage is too much it might be ideal to wait to fetch these down the line.
        await Promise.all(eventDataArr.map(async e => {
          const eventRole = await this.botdb.get('SELECT * FROM event_roles WHERE event_id = ?', e.event_id);
          const channel = await this.client.channels.fetch(e.channel_id);
          const organizer = await guild.members.fetch(e.organizer_id);
          const role = await guild.roles.fetch(eventRole.role_id) || undefined;
          if (role) { role.autoDelete = eventRole.autoDelete; }
          const eventPosts = await this.botdb.all('SELECT * FROM event_posts WHERE event_id = ?', e.event_id);
          const posts = new Discord.Collection();
          eventPosts.forEach(async p => {
            const c = await this.client.channels.fetch(p.channel_id);
            const m = await c.messages.fetch(p.message_id);
            posts.set(m.id, m);
          });
          const eventAttendees = await this.botdb.all('SELECT * FROM event_members WHERE event_id =?', e.event_id);
          const attendees = new Discord.Collection();
          eventAttendees.forEach(async a => {
            const member = await guild.members.fetch(a.user_id);
            member.attendanceStatus = a.attendance_status;
          });
          const event = new Event(e.event_name, e.event_id, channel, e.timezone, moment(e.start_time), e.duration, organizer, JSON.parse(e.attendance_options), e.recurrence_period, e.recurrence_count, role, posts, attendees);
          guildData.events.set(e.event_id, event);
        }));
        // TODO finished role handling
        // guildData.finishedRoles = [];
        // do we need this? Is there really a reason not to wipe the role immediately?
      }
      this.client.eventData.set(guild.id, guildData);
    }
  }

  /**
   * Save the state of the EventManager to the global JSON data.
   *
   * @returns {Promise<*>} Resolves when the data file has been written out.
   * TODO: reduce number of SQL statements (one insert, many values)
   */
  async saveState() {
    // const starttime = performance.now();
    const promiseArr = [];
    this.dueEvents.forEach(async (event) => {
      if (event.recurrenceCount == 0) {
        promiseArr.push(this.botdb.run('DELETE from event_data WHERE event_id = ?', event.id));
        promiseArr.push(this.botdb.run('DELETE from event_posts WHERE event_id = ?', event.id));
        promiseArr.push(this.botdb.run('DELETE from event_roles WHERE event_id = ?', event.id));
        promiseArr.push(this.botdb.run('DELETE from event_members WHERE event_id = ?', event.id));
      }
      this.dueEvents.delete(event.id);
    });
    this.client.eventData.forEach(async (guildData, guildId) => {
      guildData.events.forEach(async (event) => {
        // first, event_data table
        promiseArr.push(this.botdb.run(
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
        promiseArr.push(this.botdb.run('INSERT INTO event_roles(event_id, role_id, autodelete) VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET role_id = excluded.role_id, autodelete = excluded.autodelete WHERE role_id!=excluded.role_id OR autodelete!=excluded.autodelete', event.id, event.role.id, event.role.autoDelete));
        event.posts.forEach(async (post) => {
          promiseArr.push(this.botdb.run('INSERT OR IGNORE INTO event_posts(message_id, event_id, channel_id) VALUES(?,?,?)', post.id, event.id, post.channel.id));
        });
        event.attendees.forEach(async (member) => {
          promiseArr.push(this.botdb.run('INSERT OR IGNORE INTO event_members(event_id, user_id, attendance_status'), event.id, member.id, member.attendanceStatus);
        });
      });
    });
    await Promise.all(promiseArr);
    // const endtime = performance.now();
    // console.log(`Writing event DBs took ${endtime - starttime} milliseconds`);
    return;
  }

  /**
   * Save a single event to SQLite (instead of rewriting the whole table)
   */

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
    const now = moment();
    const promiseArr = [];
    // collect events that should be completed.
    for (const [guildId, events] of this.client.eventData) {
      if (events.size > 0) {
        const config = getConfig(this.client, guildId);
        let eventInfoChannel;
        try {eventInfoChannel = await this.client.channels.fetch(config.eventInfoChannel)}
        catch {eventInfoChannel = null;}
        // filter due events and upcoming events
        for (const [eventid, event] of events) {
          if (event.start.isSameOrBefore(now)) {
            let eventFinished = false;
            if (event.duration) {
              const [num, dur] = event.duration.split(' ');
              const eventend = moment(event.start).add(parseInt(num), dur);
              if (eventend.isAfter(now)) {
                // event is now ongoing. announce it.
                announceEvent(event);
              }
              else if (eventend.isSameOrBefore(now)) {
                eventFinished = true;
              }
            }
            else if (!event.duration) {
              announceEvent(event);
              eventFinished = true;
            }
            for (const [, message] of event.posts) {
              if (eventFinished && eventInfoChannel && message.channel.id == eventInfoChannel.id) {
                event.posts.delete(message.id);
                promiseArr.push(message.delete());
              }
              else {
                promiseArr.push(updatePost(message, event, eventFinished));
              }
            }
            if (eventFinished) {
              this.dueEvents.set(eventid, event);
              if (event.recurrenceCount == 0) {
                if (event.role.autoDelete) {
                  this.rolesPendingPrune.set(event.role.id, event.role);
                }
                // remove it from eventData
                events.delete(eventid);
              }
              else {
                // don't add the role to the prunelist; instead, reduce recurrenceCount by 1
                // and add the duration to get a new start time
                event.recurrenceCount--;
                const [num, dur] = event.recurrencePeriod.split(' ');
                event.start.add(parseInt(num), dur);
                for(const [, message] of event.posts) {
                  if (message.channel.id != config.eventInfoChannelId) {
                    event.posts.delete(message.id);
                  // post a fresh post for the event.
                  }
                }
                // Post a new event embed in the channels for the next occurence of the event.
                if (eventInfoChannel) {
                  promiseArr.push(postEventEmbed(event, eventInfoChannel).then(newPost => {event.posts.set(newPost.id, newPost);}));
                }
                promiseArr.push(postEventEmbed(event, event.channel).then(newPost => {event.posts.set(newPost.id, newPost);}));
                await Promise.all(promiseArr);
                // update the event cache with the modified start time.
                events.set(eventid, event);
              }
            }
          }
        }
        // eventData stores only upcoming events, so return those to eventData
        this.client.eventData.set(guildId, events);
      }
    }
    return await this.saveState();
  }

  /**
   * Stop running the EventManager timer.
   */
  stop() {
    clearTimeout(this.timer);
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Add a new event to the EventManager.
   *
   * @param {Event} event complete event obj
   * @returns {Promise<*>} Resolves once the event has been saved persistently.
   */
  async add(event) {
    const guild = event.channel.guild;
    this.client.eventData.set(guild.id, event);
    return await this.saveState();
  }

  /**
   * Get the event with this name on a specific guild.
   *
   * @param guildId The Snowflake corresponding to the event's guild
   * @param eventName The name of the event to retrieve
   * @returns Event data or undefined
   * TODO: update/remove
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
   * TODO: update/remove
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
   * TODO: update/remove
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
   * TODO: update/remove
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
   * TODO: update
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
   * TODO: update
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
}

let eventManager;

/**
   * Updates the post for an event if applicable.
   *
   * @param {Discord.Message} message event post message object
   * @param {Event} event
   * @param {Boolean} eventFinished
   * @returns {Promise<void>} Resolves when post update complete.
   */
async function updatePost(message, event, eventFinished = false) {
  // .
}

/**
   * Send announcement to event channel, with possible role announce
   *
   * @param {Event} event
   * @returns {Promise<void>} Resolves when announce completed.
   */
async function announceEvent(event) {
  await event.channel.send(`${event.role ? `<@${event.role.id}> :` : '' } the event **${event.name}** is starting!`);
}

/**
   * Post an event embed with reaction emoji interaction buttons to set attendance.
   *
   * @param {Event} event
   * @param {Discord.GuildChannel} channel
   * @returns {Promise<void>} Resolves when announce completed.
   */
async function postEventEmbed(event, channel) {
  // .
}

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
    const onReady = async () => {
      client.guilds.cache.forEach(async g => {
        const config = getConfig(client, g.id);
        if (!config.eventInfoChannelId) {
          console.log(`No event info channel set for ${g.id}, skipping.`);
        }
        else {
          console.log(
            `Retrieving event info channel for ${g.id}: ${config.eventInfoChannelId}`,
          );
          const eventInfoChannel = await client.channels.cache.get(config.eventInfoChannelId) || null;

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
      eventManager = new EventManager(client, botdb);
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
    // interaction listener
    client.on('interactionCreate', async interaction => {
      // only staff/admins can manage config.
      if (!(interaction.isButton() && interaction.customId.startsWith('event'))) return;
      if (getUserPermLevel(interaction.member, interaction.guild, client) != 'staff') {
        return interaction.reply({ content: 'Sorry, only staff and users with administrator-level permissions may access these controls.', ephemeral: true });
      }
      await interaction.deferUpdate();
      let newMsgPayload = false;
      // perform button action
      switch (interaction.customId) {
      case 'configPageBack':
        break;
      case 'configPageNext':
        break;
      default:
      }
      if (newMsgPayload) {
        interaction.editReply(newMsgPayload);
      }
    });
  },
};
