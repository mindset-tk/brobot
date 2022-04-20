const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton, Collection, MessageEmbed, Constants } = require('discord.js');
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
      description TEXT,
      start_time INTEGER NOT NULL,
      duration TEXT,
      organizer_id TEXT NOT NULL,
      recurrence_period INTEGER,
      recurrence_count INTEGER
      )`),
    botdb.run(`CREATE TABLE IF NOT EXISTS event_attendopts (
      event_id TEXT NOT NULL,
      listindex INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      description TEXT,
      PRIMARY KEY(event_id, emoji)
      UNIQUE (event_id,listindex)
    )`),
    botdb.run(`CREATE TABLE IF NOT EXISTS event_posts (
      message_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      channel_id TEXT NOT NULL
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

const discordMomentFullDate = (time) => `<t:${time.unix()}:F>`;
const discordMomentRelativeDate = (time) => `<t:${time.unix()}:R>`;
const discordMomentShortTime = (time) => `<t:${time.unix()}:t>`;


class Event {
  /**
   * @param {string} name
   * @param {Discord.Channel} channel
   * @param {string} timezone
   * @param {moment() date} start
   * @param {number} duration
   * @param {Discord.GuildMember} organizer
   * @param {Collection(index, Object)} attendanceOptions
   * @param {string} recurrencePeriod
   * @param {number} recurrenceCount
   * @param {Discord.Role} role
   * @param {Discord.Collection(postID, Discord.Message)} posts
   * @param {Discord.Collection(memberID, Discord.GuildMember)} attendees
   * @param {string} description
   */
  constructor(name, id, channel, timezone, start, duration, organizer, attendanceOptions, recurrencePeriod, recurrenceCount, role, posts, attendees, description) {
    this.name = name;
    this.id = id;
    this.channel = channel;
    this.timezone = timezone;
    this.start = start;
    this.duration = duration;
    this.organizer = organizer;
    this.attendanceOptions = attendanceOptions || new Collection();
    this.recurrencePeriod = recurrencePeriod || null;
    this.recurrenceCount = recurrenceCount || 0;
    this.role = role;
    this.posts = posts || new Collection();
    this.attendees = attendees || new Collection();
    this.description = description;
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
    this.eventsPendingPrune = new Collection();
    this.rolesPendingPrune = new Collection();
  }

  /**
   * Load the state of the EventManager from the database into a client var.
   * TODO SQLify
   */
  async loadState() {
    this.client.eventData = new Collection();
    // extract data from botdb and input it into client.eventData programmatically.
    for (let [, guild] of await this.client.guilds.fetch()) {
      guild = await guild.fetch();
      // TODO: get event posts channel and update it
      // const config = getConfig(this.client, guild.id);
      const guildData = {
        events: new Collection(),
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
          let role = null;
          if (eventRole) { role = await guild.roles.fetch(eventRole.role_id); };
          if (role) { role.autoDelete = eventRole.autoDelete; }
          const eventPosts = await this.botdb.all('SELECT * FROM event_posts WHERE event_id = ?', e.event_id);
          const posts = new Collection();
          for(const p of eventPosts) {
            const c = await this.client.channels.fetch(p.channel_id);
            const m = await c.messages.fetch(p.message_id);
            posts.set(m.id, m);
          }
          const eventAttendees = await this.botdb.all('SELECT * FROM event_members WHERE event_id =?', e.event_id);
          const attendees = new Collection();
          for(const a of eventAttendees) {
            const member = await guild.members.fetch(a.user_id);
            member.attendanceStatus = a.attendance_status;
            attendees.set(member.id, member);
          }
          const eventAttOpts = await this.botdb.all('SELECT * FROM event_attendopts WHERE event_id =?', e.event_id);;
          const attendanceOptions = new Collection();
          for(const o of eventAttOpts) {
            const attobj = {
              emoji: o.emoji,
              description: (o.description || null),
            };
            attendanceOptions.set(o.listindex, attobj);
          }
          const event = new Event(e.name, e.event_id, channel, e.timezone, moment(e.start_time), e.duration, organizer, attendanceOptions, e.recurrence_period, e.recurrence_count, role, posts, attendees, e.description);
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
    // console.log('deleting old posts');
    for (const [, event] of this.eventsPendingPrune) {
      // clear events from SQL that are done.
      promiseArr.push(this.botdb.run('DELETE from event_attendopts WHERE event_id = ?', event.id));
      promiseArr.push(this.botdb.run('DELETE from event_data WHERE event_id = ?', event.id));
      promiseArr.push(this.botdb.run('DELETE from event_posts WHERE event_id = ?', event.id));
      promiseArr.push(this.botdb.run('DELETE from event_roles WHERE event_id = ?', event.id));
      promiseArr.push(this.botdb.run('DELETE from event_members WHERE event_id = ?', event.id));
      this.eventsPendingPrune.delete(event.id);
    }
    for (const [guildId, guildData] of this.client.eventData) {
      for (const [, event] of guildData.events) {
        // first, event_data table
        // console.log(event);
        promiseArr.push(this.botdb.run(
          `INSERT INTO event_data(event_id, guild_id, channel_id, timezone, name, description, start_time, duration, organizer_id, recurrence_period, recurrence_count)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET
            guild_id = excluded.guild_id,
            channel_id = excluded.channel_id,
            timezone = excluded.timezone,
            name = excluded.name,
            description = excluded.description,
            start_time = excluded.start_time,
            duration = excluded.duration,
            organizer_id = excluded.organizer_id,
            recurrence_period = excluded.recurrence_period,
            recurrence_count = excluded.recurrence_count`, event.id, guildId, event.channel.id, event.timezone, event.name, event.description, event.start.format(), event.duration, event.organizer.id, event.recurrencePeriod, event.recurrenceCount));
        if (event.role) {
          // console.log('storing event_role');
          promiseArr.push(this.botdb.run(`INSERT INTO event_roles(event_id, role_id, autodelete) VALUES(?,?,?)
          ON CONFLICT(event_id) DO UPDATE SET
          role_id = excluded.role_id,
          autodelete = excluded.autodelete
          WHERE role_id!=excluded.role_id OR autodelete!=excluded.autodelete`, event.id, event.role.id, event.role.autoDelete));
        }
        for(const [, post] of event.posts) {
          // console.log('storing event_posts');
          promiseArr.push(this.botdb.run('INSERT OR IGNORE INTO event_posts(message_id, event_id, channel_id) VALUES(?,?,?)', post.id, event.id, post.channel.id));
        }
        for (const [, member] of event.attendees) {
          // console.log('storing event_members');
          promiseArr.push(this.botdb.run('INSERT OR IGNORE INTO event_members(event_id, user_id, attendance_status) VALUES(?,?,?)', event.id, member.id, member.attendanceStatus));
        }
        for (const [index, opts] of event.attendanceOptions) {
          // console.log(event.id);
          promiseArr.push(this.botdb.run('INSERT OR IGNORE INTO event_attendopts(event_id, listindex, emoji, description) VALUES(?,?,?,?)', event.id, index, opts.emoji, opts.description));
        }
      }
    }
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
    for (const [guildId, guildData] of this.client.eventData) {
      const events = guildData.events;
      if (events.size > 0) {
        const config = getConfig(this.client, guildId);
        let eventInfoChannel;
        try {eventInfoChannel = await this.client.channels.fetch(config.eventInfoChannel);}
        catch {eventInfoChannel = null;}
        // filter due events and upcoming events
        for (const [eventid, event] of events) {
          // console.log(event.start);
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
              // clear the completed event from the upcoming events channel
              // TODO? add an event archival channel?
              if (eventFinished && eventInfoChannel && message.channel.id == eventInfoChannel.id) {
                event.posts.delete(message.id);
                promiseArr.push(message.delete());
              }
              else {
                promiseArr.push(updatePost(message, event, eventFinished));
              }
            }
            if (eventFinished) {
              // if the event is completed and has no further recurrences, pass it to eventsPendingPrune so it can be cleaned up.
              if (event.recurrenceCount == 0) {
                this.eventsPendingPrune.set(eventid, event);
                if (event.role && event.role.autoDelete) {
                  this.rolesPendingPrune.set(event.role.id, event.role);
                }
                // remove it from eventData
                events.delete(eventid);
              }
              else {
                // don't add the role to the prunelist; instead, reduce recurrenceCount by 1
                // and add the duration to get a new start time
                // TODO also reset attendance list?
                // TODO update event embeds in non-event channels to signify that event is completed
                event.recurrenceCount--;
                const [num, dur] = event.recurrencePeriod.split(' ');
                event.start.add(parseInt(num), dur);
                for(const [, message] of event.posts) {
                  event.posts.delete(message.id);
                }
                // Post a new event embed in the upcoming events channel for the next occurence of the event.
                if (eventInfoChannel) {
                  promiseArr.push(postEventEmbed(event, eventInfoChannel).then(newPost => {event.posts.set(newPost.id, newPost);}));
                }
                // and post a second embed in the event's specific channel if it's not the upcoming channel
                else if (event.channel.id != eventInfoChannel) {
                  promiseArr.push(postEventEmbed(event, event.channel).then(newPost => {event.posts.set(newPost.id, newPost);}));
                }
                await Promise.all(promiseArr);
                // update the event cache with the new event data
                events.set(eventid, event);
              }
            }
          }
        }
        guildData.events = events;
        // eventData stores only upcoming events, so return those to eventData
        this.client.eventData.set(guildId, guildData);
      }
    }
    await this.saveState();
    return;
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
    const guildData = this.client.eventData.get(guild.id) || new Collection();
    guildData.events.set(event.id, event);
    this.client.eventData.set(guild.id, guildData);
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
   * Post a new event embed with reaction emoji interaction buttons to set attendance.
   *
   * @param {Event} event
   * @param {Discord.GuildTextChannel} channel
   * @returns {Promise<Discord.Message>} Returns the message after it is posted in the channel.
   */
async function postEventEmbed(event, channel) {
  const msgPayload = await generatePost(event);
  const msg = await channel.send(msgPayload);
  return msg;
}

/**
 * Edit an event post via interaction.
 *
 * @param {Discord.Interaction} interaction
 *
 * @returns {Promise<void>} Resolves when all messages are updated.
 */
async function editEventPosts(interaction) {
  const event = getEventByPost(interaction);
  const editedEvent = await dmEditEvent(interaction, event);
  const msgPayload = await generatePost(editedEvent);
  const promiseArr = [];
  for (const [, message] of event.posts) {
    // edit every post except for the interaction post;
    // this is to avoid a discord API error about unhandled interactions.
    if (message.id != interaction.message.id) {
      promiseArr.push(message.edit(msgPayload));
    }
  }
  // ...and then edit the original reaction.
  promiseArr.push(interaction.editReply(msgPayload));
  await Promise.all(promiseArr);
  return;
}

/**
 * Delete an event post via interaction.
 * TODO WRITE
 * @param {Discord.Interaction} interaction
 *
 * @returns {Promise} Resolves to message embed
 */
async function deleteEventByPost(interaction) {
  const msgContents = {};
  const event = getEventByPost(interaction);
  return msgContents;
}

/**
 * Update the attendance of an event, then return a message embed.
 * TODO WRITE
 * @param {Discord.Interaction} interaction
 * @param {}
 * @returns {Promise} Resolves to message embed
 */
async function updateAttendance(interaction) {
  const msgContents = {};
  const event = getEventByPost(interaction);
}

/**
 * start and run dm loop to edit event
 *
 * @param {Discord.User} user user data
 *
 * @returns {Promise<Event>} updated/edited event data.
 */
async function dmEditEvent(interaction, event) {
  const dmChannel = await interaction.user.createDM();
  try {
    await dmChannel.send('a');
  }
  catch(err) {
    if (err.message == 'Cannot send messages to this user') {
      interaction.reply({ content: 'Sorry, I can\'t seem to DM you. Please make sure that your privacy settings allow you to recieve DMs from this bot.', ephemeral: true });
    }
    else {
      interaction.reply({ content: 'There was an error sending you a DM! Please check your privacy settings.  If your settings allow you to recieve DMs from this bot, check the console for full error review.', ephemeral:true });
      console.log(err);
    }
    return event;
  }
}

// find an event by its interaction ID.
async function getEventByPost(interaction) {
  const guildEvents = interaction.client.eventData.get(interaction.guild.id);
  for (const [, e] of guildEvents) {
    if (e.posts.has(interaction.message.id)) {
      return e;
    }
  }
}

/**
 * generate a fresh message payload for posting
 * @param {Event} event
 *
 * @returns {Discord.MessagePayload} message data to be posted, including interaction buttons.
 */
async function generatePost(event) {
  const rows = [];
  const firstActionRow = new MessageActionRow();
  const secondActionRow = new MessageActionRow();
  const thirdActionRow = new MessageActionRow();
  const buttonArr = [];
  let eventend;
  if (event.duration) {
    const [num, dur] = event.duration.split(' ');
    eventend = moment(event.start).add(parseInt(num), dur);
  }
  // ensure we sort attendance options by key (index)
  event.attendanceOptions = new Map([...event.attendanceOptions].sort((a, b) => String(a[0]).localeCompare(b[0])));
  const attendeeMap = new Map();
  for (const [, member] of event.attendees) {
    if (attendeeMap.has(member.attendanceStatus)) {
      const arr = attendeeMap.get(member.attendanceStatus);
      arr.push(member);
      attendeeMap.set(member.attendanceStatus, arr);
    }
    else {
      attendeeMap.set(member.attendanceStatus, [member]);
    }
  }
  const embed = new MessageEmbed()
    .setTitle(event.name)
    .addFields({ name: 'Time', value: `${discordMomentFullDate(event.start)}${eventend ? '-' + discordMomentShortTime(eventend) : ''}  ${discordMomentRelativeDate(event.start)}` })
    .setFooter({ text: `Created by ${event.organizer.displayName}`, iconURL: event.organizer.displayAvatarURL() });
  for (const [, opts] of event.attendanceOptions) {
    const memberArr = attendeeMap.get(opts.emoji);
    const fieldVal = [];
    if (memberArr) {
      for (const member of memberArr) {
        fieldVal.push(member.displayName);
      }
    }
    else {fieldVal.push('-');}
    embed.addField(`${opts.emoji} - ${opts.description}`, fieldVal.join('\n'), true);
    const button = new MessageButton();
    button.setCustomId(`eventAttendance${opts.emoji}`)
      .setEmoji(opts.emoji)
      .setStyle('SECONDARY');
    buttonArr.push(button);
  }
  if (event.description) {
    embed.setDescription(event.description);
  }
  const editButton = new MessageButton()
    .setCustomId('eventEdit')
    .setStyle('PRIMARY')
    .setLabel('Edit');
  const deleteButton = new MessageButton()
    .setCustomId('eventDelete')
    .setStyle('DANGER')
    .setLabel('Delete');
  buttonArr.push(editButton, deleteButton);
  // console.log(buttonArr);
  for(let i = 0; i < (buttonArr.length); i++) {
    if (i < 5) {
      firstActionRow.addComponents(buttonArr[i]);
    }
    else if (i < 10) {
      secondActionRow.addComponents(buttonArr[i]);
    }
    else if (i >= 10) {
      thirdActionRow.addComponents(buttonArr[i]);
    }
  }
  rows.push(firstActionRow);
  if (secondActionRow.components.length > 0) {rows.push(secondActionRow);}
  if (thirdActionRow.components.length > 0) {rows.push(thirdActionRow);}
  return { embeds: [embed], components: rows };
}

async function createEvent(interaction) {
  interaction.reply('boobs');
  const newEvent = new Event();
  newEvent.id = (Date.now().toString(10) + (Math.random() * 999).toFixed(0).toString(10).padStart(3, '0'));
  newEvent.channel = interaction.options.getChannel('channel');
  newEvent.organizer = interaction.member;
  newEvent.start = moment(interaction.options.getString('start'), 'x');
  newEvent.name = interaction.options.getString('name');
  newEvent.timezone = 'PDT';
  newEvent.recurrenceCount = 0;
  newEvent.attendanceOptions.set(1, { emoji: '✅', description: 'Accept' });
  newEvent.attendanceOptions.set(2, { emoji: '🤔', description: 'Maybe' });
  newEvent.attendanceOptions.set(3, { emoji: '❎', description: 'Decline' });
  const newPost = await postEventEmbed(newEvent, newEvent.channel);
  newEvent.posts.set(newPost.id, newPost);
  await eventManager.add(newEvent);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create or manage events')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('create an event')
        .addStringOption(option => option
          .setName('name')
          .setDescription('name for event'))
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel for event'))
        .addStringOption(option => option
          .setName('start')
          .setDescription('unix start time for event')))
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
      await createEvent(interaction);
      // JSON.parse();
      break;
    case 'edit':
      interaction.reply('edit');
      break;
    case 'cancel':
      interaction.reply('cancel');
      break;
    }
  },
  async init(client, botdb) {
    // prep the necessary tables in the db.
    await prepTables(botdb);
    // Ensure the client is ready so that event catch-up doesn't fail
    // due to not knowing about the channel.
    const onReady = async () => {
      for(const [ , g] of client.guilds.cache) {
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
      }
      eventManager = new EventManager(client, botdb);
      eventManager.loadState(client, botdb).then(() => {
        eventManager.start();
        console.log('Event manager ready.');
      });
    };

    if (client.status !== Constants.Status.READY) {
      client.on('ready', onReady);
    }
    else {
      onReady();
    }
    // interaction listener
    client.on('interactionCreate', async interaction => {
      // only staff/admins can manage config.
      if (!(interaction.isButton() && interaction.customId.startsWith('event'))) return;
      await interaction.deferUpdate();
      let newMsg = false;
      // handle event creation buttons.
      switch (interaction.customId.subString(0, 15)) {
      case 'eventEdit':
        await editEventPosts(interaction);
        break;
      case 'eventDelete':
        await deleteEventByPost(interaction);
        interaction.delete();
        break;
      case 'eventAttendance':
        newMsg = await updateAttendance(interaction);
        break;
      default:
      }
      if (newMsg) {
        interaction.editReply(newMsg);
      }
    });
  },
};
