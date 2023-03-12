const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton, Collection, MessageEmbed, Constants } = require('discord.js');
const moment = require('moment-timezone');
const tz = require('../extras/timezones');
const { promptForMessage, promptYesNo, getUserPermLevel, getConfig, validateEmoji } = require('../extras/common.js');
const { performance } = require('perf_hooks');
const Sugar = require('sugar-date');
const { RRule } = require('rrule');

function generateTimeZoneEmbed() {
  const zonesByRegion = new Collection();
  for (const zone of tz.LOCAL_TIMEZONES) {
    let regData = zonesByRegion.get(zone.region);
    if (!regData) {
      regData = [];
    }
    regData.push(zone);
    zonesByRegion.set(zone.region, regData);
  }
  const tzEmbed = new MessageEmbed();
  const zoneArr = [];
  let i = 0;
  for (const [region, zones] of zonesByRegion) {
    let fieldVal = '';
    for (const zone of zones) {
      zoneArr.push(zone);
      i++;
      fieldVal += `**${i}.** ${zone.name}\n`;
    }
    tzEmbed.addField(region, fieldVal, true);
  }
  tzEmbed.setFooter({ text: 'To exit type \'cancel\'.' });
  tzEmbed.setTitle('Enter your time zone\'s number');
  tzEmbed.setDescription('Alternatively, enter a UTC/GMT time code like \'UTC+1\'. Note that manual time codes will not follow any Daylight Savings time adjustments.');
  return [tzEmbed, zoneArr];
}

const [TZEMBED, TZARR] = generateTimeZoneEmbed();

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
      duration INTEGER,
      organizer_id TEXT NOT NULL,
      recurrence JSON
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
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      attendance_status TEXT NOT NULL,
      PRIMARY KEY(event_id, user_id)
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
   * @param {object} recurrence
   * @param {Discord.Role} role
   * @param {Discord.Collection(postID, Discord.Message)} posts
   * @param {Discord.Collection(memberID, Discord.GuildMember)} attendees
   * @param {string} description
   */
  constructor(name, id, channel, timezone, start, duration, organizer, attendanceOptions, recurrence, role, posts, attendees, description) {
    this.name = name;
    this.id = id;
    this.channel = channel;
    this.timezone = timezone;
    this.start = start || null;
    this.duration = Number(duration || 0);
    this.organizer = organizer || null;
    this.attendanceOptions = attendanceOptions || new Collection();
    this.recurrence = recurrence || null;
    this.role = role || undefined;
    this.posts = posts || new Collection();
    this.attendees = attendees || new Collection();
    this.description = description || '';
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
   * Load the state of the EventManager from the database into client.eventData
   *
   */
  async loadState() {
    this.client.eventData = new Collection();
    // extract data from botdb and input it into client.eventData programmatically.
    for (let [, guild] of await this.client.guilds.fetch()) {
      guild = await guild.fetch();
      // TODO: get event posts channel and update it
      // actually I think the first tick kind of handles this?
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
          if (eventRole) { role = await guild.roles.fetch(eventRole.role_id); }
          if (role) { role.autoDelete = eventRole.autoDelete; }
          const recurrence = e.recurrence ? RRule.fromString(e.recurrence) : null;
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
          const eventAttOpts = await this.botdb.all('SELECT * FROM event_attendopts WHERE event_id =?', e.event_id);
          const attendanceOptions = new Collection();
          for(const o of eventAttOpts) {
            const attobj = {
              emoji: o.emoji,
              description: (o.description || null),
            };
            attendanceOptions.set(o.listindex, attobj);
          }
          const event = new Event(e.name, e.event_id, channel, e.timezone, moment.tz(e.start_time, e.timezone), e.duration, organizer, attendanceOptions, recurrence, role, posts, attendees, e.description);
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
          `INSERT INTO event_data(event_id, guild_id, channel_id, timezone, name, description, start_time, duration, organizer_id, recurrence)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET
            guild_id = excluded.guild_id,
            channel_id = excluded.channel_id,
            timezone = excluded.timezone,
            name = excluded.name,
            description = excluded.description,
            start_time = excluded.start_time,
            duration = excluded.duration,
            organizer_id = excluded.organizer_id,
            recurrence = excluded.recurrence`, event.id, guildId, event.channel.id, event.timezone, event.name, event.description, event.start.format(), event.duration, event.organizer.id, event.recurrence));
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
   * TODO: Create a function to save a single event to SQLite (instead of rewriting the whole table)
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
      // TODO: cleanup this func; add guard here and split out to funcs.
      const events = guildData.events;
      if (events.size > 0) {
        const config = getConfig(this.client, guildId);
        let eventInfoChannel;
        try {eventInfoChannel = await this.client.channels.fetch(config.eventInfoChannel);}
        catch {eventInfoChannel = null;}
        // iterate through events and handle due and upcoming events
        for (const [eventid, event] of events) {
          if (event.start.isSameOrBefore(now)) {
            let eventFinished = false;
            if (event.duration > 0) {
              const eventend = moment(event.start).add(event.duration, 'minutes');
              if (eventend.isAfter(now)) {
                // event is now ongoing. announce it.
                announceEvent(event);
              }
              else if (eventend.isSameOrBefore(now)) {
                eventFinished = true;
              }
            }
            else if (event.duration === 0) {
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
                promiseArr.push(updateOngoingEvent(message, event, eventFinished));
              }
            }
            if (eventFinished) {
              // if the event is completed and has no further recurrences, pass it to eventsPendingPrune so it can be cleaned up.
              // shallow copy start since .tz() modifies the original object.
              const modStart = moment({ ...event.start });
              const nextOccurence = event.recurrence ? event.recurrence.after(new Date(modStart.tz('UTC', true))) : null;
              if (!event.recurrence || !nextOccurence) {
                this.eventsPendingPrune.set(eventid, event);
                if (event.role && event.role.autoDelete) {
                  this.rolesPendingPrune.set(event.role.id, event.role);
                }
                // remove it from eventData
                events.delete(eventid);
              }
              else {
                // TODO reset attendance list for each recurrence?
                // TODO update event embeds in non-event channels to signify that event is completed, and post fresh embed.
                // Get a new start date.
                event.start = moment(nextOccurence).tz('UTC').tz(event.timezone, true);
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
   * Set an event in the event manager.
   *
   * @param {Event} event complete event obj
   * @returns {Promise<*>} Resolves once the event has been saved persistently.
   */
  async set(event) {
    const guild = event.channel.guild;
    const guildData = this.client.eventData.get(guild.id) || new Collection();
    guildData.events.set(event.id, event);
    this.client.eventData.set(guild.id, guildData);
    return await this.saveState();
  }

  /**
   * Remove an event from the event manager and save state.
   * This should only be called after any recurrence is over.
   * TODO test to ensure this is working as expected. should be done.
   * @param {Event} event complete event obj
   * @returns {Promise<*>} Resolves once events have been saved persistently.
   */
  async delete(event) {
    const guild = event.channel.guild;
    const guildData = this.client.eventData.get(guild.id);
    guildData.events.delete(event.id);
    this.client.eventData.set(guild.id, guildData);
    this.eventsPendingPrune.set(event.id, event);
    if (event.role && event.role.autoDelete) {
      this.rolesPendingPrune.set(event.role.id, event.role);
    }
    return await this.saveState();
  }
}

let eventManager;

/**
   * Updates a single post for an event based on if it is finished or ongoing.
   *
   * @param {Discord.Message} message event post message object
   * @param {Event} event
   * @param {Boolean} eventFinished if true, removes interaction buttons from the post & updates
   * description to state that the event is finished. if false, description will state that event is onging.
   * TODO? better readability if this is remade to "updateEventPost" and checks for itself if the event is
   * completed/ongoing?
   * @returns {Promise<void>} Resolves when post update complete.
   */
async function updateOngoingEvent(message, event, eventFinished = false) {
  const msgPayload = await generatePost(event);
  if (eventFinished) {
    msgPayload.embeds[0].setDescription(msgPayload.embeds[0].description ? `${msgPayload.embeds[0].description}\n Event is now finished.` : 'Event is now finished.');
    const newRows = [];
    msgPayload.components.forEach(row => {
      for(let i = 0; i < (row.components.length); i++) {
        row.components[i].setDisabled(true);
      }
      newRows.push(row);
    });
    msgPayload.components = newRows;
    //  console.log(interaction.message);
  }
  else {
    msgPayload.embeds[0].setDescription(msgPayload.embeds[0].description ? `${msgPayload.embeds[0].description}\n Event is ongoing!` : 'Event is ongoing!');
  }
  await message.edit(msgPayload);
}

/**
   * Send announcement to event channel, with possible role mention
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
async function editEventButton(interaction) {
  const event = await getEventByPost(interaction);
  const editedEvent = await dmEditEvent(interaction, event);
  if (editedEvent) {
    const guildData = interaction.client.eventData.get(interaction.guild.id);
    guildData.events.set(editedEvent.id, editedEvent);
    const msgPayload = await generatePost(editedEvent);
    const promiseArr = [];
    for (const [, message] of event.posts) {
    // edit every post except for the interaction post;
    // this is to avoid a discord API error about unhandled interactions.
      if (message.id != interaction.message.id) {
        promiseArr.push(message.edit(msgPayload));
      }
    }
    // ...and then edit the original interaction post that the user pressed a button on.
    promiseArr.push(interaction.editReply(msgPayload));
    promiseArr.push(eventManager.saveState);
    await Promise.all(promiseArr);
  }
  // unnecesary; handle replies upstream of this.
  // else { interaction.reply({ conent: 'Event editing cancelled!', ephemeral: true }); }
  return;
}

/**
 * Delete an event via interaction.
 *
 * @param {Discord.Interaction} interaction
 *
 * @returns {Promise} Resolves to message embed
 */
async function deleteEventButton(interaction) {
  const config = getConfig(interaction.client, interaction.guild.id);
  let staffrole;
  try { staffrole = interaction.guild.roles.fetch(config.staffrole); }
  catch { staffrole = null; }
  const event = await getEventByPost(interaction);
  if (interaction.member.id != event.organizer.id && getUserPermLevel(interaction.member, interaction.guild, interaction.client) != 'staff') {
    return interaction.followUp(`Sorry, only the organizer${staffrole ? ` or someone with the @${staffrole.name} role` : ''} can delete an event.`);
  }
  const newRows = [];
  interaction.message.components.forEach(row => {
    for(let i = 0; i < (row.components.length); i++) {
      row.components[i].setDisabled(true);
    }
    newRows.push(row);
  });
  const promiseArr = [];
  const msgPayload = { content: 'Event deleted.', embeds: [], components: newRows };
  for (const [, message] of event.posts) {
    // edit every post except for the interaction post;
    // this is to avoid a discord API error about unhandled interactions.
    if (message.id != interaction.message.id) {
      if (message.channel.id == config.eventInfoChannelId) {
        message.delete();
      }
      else {
        promiseArr.push(message.edit(msgPayload));
      }
    }
  }
  // ...and then edit the original interaction.
  promiseArr.push(interaction.editReply(msgPayload));
  // finally, delete from the upcoming event info channel.
  if (interaction.channel.id == config.eventInfoChannelId) {
    interaction.message.delete();
  }
  promiseArr.push(eventManager.delete(event));
  await Promise.all(promiseArr);
  return;
}

/**
 * Update the attendance of an event, then push the new event data into the eventManager.
 * TODO add role functionality
 * @param {Discord.Interaction} interaction
 *
 * @returns {Promise} Resolves when message is updated and state is saved.
 */
async function updateAttendanceButton(interaction) {
  const event = await getEventByPost(interaction);
  // get emoji; if it's a unicode emoji it will be only a couple chars long, otherwise
  // discord emoji string - <:emojiname:snowflake>
  const emoji = interaction.customId.slice(15);
  const member = interaction.member;
  if (event.attendees.has(member.id)) {
    const currentAttendance = event.attendees.get(member.id);
    if (currentAttendance.attendanceStatus == emoji) {
      event.attendees.delete(member.id);
    }
    else {
      member.attendanceStatus = emoji;
      event.attendees.set(member.id, member);
    }
  }
  else {
    member.attendanceStatus = emoji;
    event.attendees.set(member.id, member);
  }
  const msgPayload = await generatePost(event);
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
  promiseArr.push(eventManager.set(event));
  await Promise.all(promiseArr);
  return;
}

/**
 * start and run dm loop to edit event
 *
 * @param {Discord.User} interaction user data
 * @param {Event} event event
 *
 * @returns {Promise<Event>} updated/edited event data.
 */
async function dmEditEvent(interaction, event) {
  const dmChannel = await interaction.user.createDM();
  // make a shallow copy of event so we aren't modifying the one in memory.
  let newEvent = { ...event };
  // first message sent in a try/catch so we can catch any errors sending the dm
  // discord.js needs a ".canDM()" method or something cmon
  // build initial embed.
  let editloop = true;
  let result = '';
  let editEmbed = generateEditEmbed(newEvent);
  try {
    await dmChannel.send({ content: 'You may type \'cancel\' at any point in this process to abort without saving your changes.', embeds: [editEmbed] });
  }
  catch(err) {
    if (err.message == 'Cannot send messages to this user') {
      interaction.followUp({ content: 'Sorry, I can\'t seem to DM you. Please make sure that your privacy settings allow you to recieve DMs from this bot.', ephemeral: true });
      return false;
    }
    else {
      interaction.followUp({ content: 'There was an error sending you a DM! Please check your privacy settings.  If your settings allow you to recieve DMs from this bot, check the console for full error review.', ephemeral:true });
      console.log(err);
      return false;
    }
  }
  result = await promptForMessage(dmChannel, async (reply) => {
    // response here should be simple - 1 through 8.
    const content = reply.content.trim();
    if (!(Number(content) > 0 && Number(content) <= 8)) {
      switch(content.toLowerCase()) {
      case 'cancel':
      case 'abort':
        dmChannel.send('Event creation cancelled. Please edit the event again to restart the process.');
        return 'abort';
      default:
        dmChannel.send('I\'m sorry, I didn\'t understand that.  Please only respond with a number from 1 to 8, or \'cancel\' to cancel.');
        return 'retry';
      }
    }
    else { return parseInt(Number(content)); }
  });

  if (!result) { editloop = false; }

  while (editloop) {
    switch (result) {
    case 1:
      [newEvent, result] = await dmPromptEventName(dmChannel, newEvent, 'edit');
      break;
    case 2:
      [newEvent, result] = await dmPromptEventDescription(dmChannel, newEvent, 'edit');
      break;
    case 3:
      [newEvent, result] = await dmPromptStart(dmChannel, newEvent, 'edit');
      break;
    case 4:
      [newEvent, result] = await dmPromptDuration(dmChannel, newEvent, 'edit');
      break;
    case 5:
      [newEvent, result] = await dmPromptRecurrence(dmChannel, newEvent, 'edit');
      break;
    case 6:
      [newEvent, result] = await dmPromptAttOpts(dmChannel, newEvent, 'edit');
      break;
    case 7:
      [newEvent, result] = await dmPromptRole(dmChannel, newEvent, 'edit');
      break;
    case 8:
      [newEvent, result] = await dmPromptAutoDelete(dmChannel, newEvent, 'edit');
      break;
    }
    if (result && result !== 'cancel') {
      editEmbed = generateEditEmbed(newEvent);
      await dmChannel.send({ content: 'OK, done. Here is your new event. Please select an item, or type \'done\' to save your edits. \n***Your edits will not be saved until you type \'done\'***', embeds: [editEmbed] });
      result = await promptForMessage(dmChannel, async (reply) => {
      // response here should be simple - 1 through 8.
        const content = reply.content.trim();
        if (!(Number(content) > 0 && Number(content) <= 8)) {
          switch(content.toLowerCase()) {
          case 'cancel':
          case 'abort':
            dmChannel.send('Event creation cancelled. Please edit the event again to restart the process.');
            return 'abort';
          case 'done':
          case 'save':
            dmChannel.send('Great! I will save your event and update the related posts.');
            return 'save';
          default:
            dmChannel.send('I\'m sorry, I didn\'t understand that.  Please only respond with a number from 1 to 8, or \'cancel\' to cancel.');
            return 'retry';
          }
        }
        else { return parseInt(Number(content)); }
      });
    }
    if (!result || result === 'save' || result === 'cancel') { editloop = false; }
  }
  if (result === 'save') { return newEvent; }
  else {
    interaction.followUp({ content: 'Event editing cancelled!', ephemeral: true });
    return false;
  }
}

/**
 * Generate two strings in an array:
 * a date string formatted like: Sat, May 28, 2022, 02:55 PDT (UTC-7)
 * a time zone sting formatted like: "UTC+1" or "PDT (UTC-7)"
 * depending on if the time zone has an abbreviation or just a raw offset.
 * @param {moment-timezone object} date
 * @returns {array [string, string]} arr containing [date string, time zone string]
 */
function generateStartStr(date) {
  const regMatch = date.format('Z').match(/(\+|-)(\d{2}):(\d{2})/);
  let utcCode = 'UTC';
  if (regMatch && !(regMatch[2] === '00' && regMatch[3] === '00')) {
    utcCode += `${regMatch[1]}${regMatch[2].startsWith('0') ? regMatch[2].slice(1) : regMatch[2]}${regMatch[3] == '00' ? '' : `:${regMatch[3]}`}`;
  }
  const tzString = date.format('z').match(/(\+|-)(\d+)/) ? utcCode : `${date.format('z')} (${utcCode})`;
  return [`${date.format('ddd, MMM D, YYYY, HH:mm')} ${tzString}`, tzString ];
}

/**
 * Convert a duration in minutes to a string for display ('1 day, 2 hours, 5 minutes')
 *
 * @param {Number} minutes;
 * @returns {String}
 */
function formatDurationStr(minutes) {
  const days = Math.floor(minutes / (60 * 24));
  minutes -= (days * (60 * 24));
  const hours = Math.floor(minutes / (60));
  minutes -= (hours * (60));
  let durationStr = '';
  if (days > 0) {
    durationStr += `${days} ${days === 1 ? 'day' : 'days'}`;
    if (hours > 0 || minutes > 0) {
      durationStr += ', ';
    }
  }
  if (hours > 0) {
    durationStr += `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    if (minutes > 0) {
      durationStr += ', ';
    }
  }
  if (minutes > 0) {
    durationStr += `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return durationStr;
}

/**
 * Format a human-readable recurrence out of the recurrencePeriod string
 *
 * @param {RRule} recurrenceRule
 * @returns {*} human-readable recurrence
 */
function formatRecurrenceStr(event) {
  let fmtStr = '';
  if (!event.recurrence) {
    return 'No recurrence';
  }
  fmtStr += event.recurrence.toText();
  fmtStr += '.';
  return fmtStr;
}

/**
 * Generate an embed with current data for an event as numbered choices for editing.
 *
 * @param {Event} event
 * @returns {MessageEmbed}
 */
function generateEditEmbed(event) {
  const [ startStr ] = generateStartStr(event.start);
  let attOptStr = '';
  let durationStr = '';
  for(const obj of event.attendanceOptions.values()) {
    attOptStr += `${obj.emoji}${obj.description ? ` - ${obj.description}` : ''}\n`;
  }
  if (attOptStr.length > 1) { attOptStr = attOptStr.slice(0, -1); }
  else { attOptStr = '-'; }
  if (event.duration === 0 || !event.duration) {
    durationStr = '-';
  }
  else {durationStr = formatDurationStr(event.duration); }
  const recurrenceStr = formatRecurrenceStr(event);
  const embed = new MessageEmbed()
    .setTitle('What would you like to modify?')
    .addFields([{ name: '1 ⋅ Title', value: event.name },
      { name: '2 ⋅ Description', value: (event.description || '-') },
      { name: '3 ⋅ Start time and time zone', value: startStr, inline: true },
      { name: '4 ⋅ Duration', value: (durationStr), inline: true },
      { name: '5 ⋅ Repeats', value: recurrenceStr },
      { name: '6 ⋅ Signup choices', value: attOptStr, inline: true },
      { name: '7 ⋅ Event role mention', value: (event.role || '-'), inline: true },
      { name: '8 ⋅ Autodelete role?', value: (event.role ? (event.role.autoDelete ? 'Yes' : 'No') : '-'), inline: true }])
    .setFooter({ text: 'Enter a number to select an option. To exit, type \'cancel\'' });
  return embed;
}

/**
 * Functions to ask for name of supplied event. If 'mode' is set to 'edit', enables
 * 'back' keyword so user can return to edit without changing mode.
 *
 * @param {*} dmChannel
 * @param {*} event
 * @param {string} mode 'edit' or 'new' based on verbage needed.
 * @returns {Array[Event, Boolean]} [event object, bool will only be false if aborted]
 */
async function dmPromptEventName(dmChannel, event, mode = 'new') {
  dmChannel.send(`${event.name ? `Current event name is **${event.name}**.` : ''} What would you like to name your event?`);
  const result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim();
    if (content.length >= 250) {
      dmChannel.send(`Event names must be less than 250 characters in length.  Please enter a new name,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : ''} or 'cancel' to quit this process entirely without saving changes.`);
      return 'retry';
    }
    let YN = {};
    switch(content.toLowerCase()) {
    case 'back':
      if (mode === 'new') {
        dmChannel.send('Sorry, \'back\' is a keyword that can\'t be used here. Please enter a new name, or \'cancel\' to quit this process.');
        return 'retry';
      }
      else { return true; }
    case 'cancel':
    case 'abort':
      dmChannel.send(`Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`);
      return 'abort';
    default:
      dmChannel.send(`Great! The new name will be **${content}**. Is this OK?  **Y/N**`);
      YN = await promptYesNo(dmChannel, {
        messages: {
          no: `OK, please type a new name,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : ''} or 'cancel' to quit this process entirely without saving changes.`,
          cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
          invalid: `Reply not recognized! Please answer Y or N. Is **${content}** an acceptable name for the event? **Y/N**`,
        },
      });
      if (YN !== false) {
        switch (YN.answer) {
        case true:
          event.name = content;
          return event;
        case false:
          return 'retry';
        }
      }
      else { return 'abort'; }
    }
  });
  if (!result) {
    return [event, 'cancel'];
  }
  else {
    return [event, true];
  }
}

/**
 * Functions to ask for description of supplied event. If 'mode' is set to 'edit', enables
 * 'back' keyword so user can return to edit without changing mode.
 *
 * @param {*} dmChannel
 * @param {*} event
 * @param {string} mode 'edit' or 'new' based on verbage needed.
 * @returns {Array[Event, Boolean]} [event object, bool will only be false if aborted]
 */
async function dmPromptEventDescription(dmChannel, event, mode = 'new') {
  dmChannel.send(`${event.description.length > 0 ? `Current event description is **${event.description}**.` : ''} Please provide a description for your event; you can also type 'skip' or 'none' to have no description.`);
  const result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim();
    if (content.length >= 1000) {
      dmChannel.send(`Event descriptions must be less than 1000 characters in length.  Please enter a new description,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : '\'skip\' to skip this optional attribute,'} or 'cancel' to quit this process entirely without saving changes.`);
      return 'retry';
    }
    let YN = {};
    switch(content.toLowerCase()) {
    case 'back':
      if (mode === 'new') {
        dmChannel.send('Sorry, \'back\' is a keyword that can\'t be used here. Please enter a new name, or \'cancel\' to quit this process.');
        return 'retry';
      }
      else { return true; }
    case 'skip':
    case 'none':
      event.description = undefined;
      return true;
    case 'cancel':
    case 'abort':
      dmChannel.send(`Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`);
      return 'abort';
    default:
      dmChannel.send(`Great! The new description will be **${content}**. Is this OK?  **Y/N**`);
      YN = await promptYesNo(dmChannel, {
        messages: {
          no: `OK, please type a new description,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : '\'skip\' to skip this optional attribute,'} or 'cancel' to quit this process entirely without saving changes.`,
          cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
          invalid: `Reply not recognized! Please answer Y or N. Is **${content}** an acceptable name for the event? **Y/N**`,
        },
      });
      if (YN !== false) {
        switch (YN.answer) {
        case true:
          event.description = content;
          return event;
        case false:
          return 'retry';
        }
      }
      else { return 'abort'; }
    }
  });
  if (!result) {
    return [event, 'cancel'];
  }
  else {
    return [event, true];
  }
}

/**
 *  Function to ask for timezone of supplied event, then the start date.
 *  Uses natural language processing for date.
 *  If 'mode' is set to 'edit', enables 'back' keyword so user can return to edit without changing mode.
 *
 * @param {*} dmChannel
 * @param {*} event
 * @param {string} mode 'edit' or 'new' based on verbage needed.
 * @returns {Array[Event, String('cancel'|true)]} [event object, ]
 */
async function dmPromptStart(dmChannel, event, mode = 'new') {
  let YN = {};
  let promptTZ = true;
  let promptDate = true;
  let tzStr = '';
  let startStr;
  // newStart and newTZ are holding values that get saved to event.start and
  // event.timezone respectively if date entry is not cancelled or backed out of.
  let newStart = false;
  let newTZ = false;
  if (mode === 'edit') {
    [, tzStr] = generateStartStr(event.start);
    dmChannel.send({ content: `Current time zone is **${tzStr}**. Would you like to change it? **Y/N**` });
    YN = await promptYesNo(dmChannel, {
      messages: {
        no: 'No problem.',
        cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
        invalid: `Reply not recognized! Please answer Y or N. Current time zone is **${tzStr}**. Would you like to change it? **Y/N**`,
      },
    });
    if (YN !== false) {
      switch (YN.answer) {
      case true:
        promptTZ = true;
        break;
      case false:
        promptTZ = false;
        break;
      }
    }
    else { return [event, 'cancel']; }
  }
  if (mode === 'new' || promptTZ === true) {
    dmChannel.send({ embeds: [TZEMBED] });
    const result = await promptForMessage(dmChannel, async (reply) => {
      const content = reply.content.trim();
      let tzString;
      if (content.toLowerCase() === 'back' && mode === 'edit') {
        // reset temp var and return
        newTZ = false;
        return 'back';
      }
      else if (content.toLowerCase() === 'cancel') {
        return 'abort';
      }
      else if (Number(content) > 0 && Number(content) <= TZARR.length) {
        const idx = parseInt(Number(content) - 1);
        newTZ = TZARR[idx];
      }
      else if(content.match(/(?:UTC|GMT)(\+|-)*(\d{1,2})?\n/)) {
        const match = content.match(/(?:UTC|GMT)(\+|-)*(\d{1,2})?\n/);
        newTZ.locale = tz.UTC_TIMEZONES[match[0]];
        newTZ.name = match[0];
      }
      else {
        dmChannel.send(`Sorry, I didn't recognize that reply. Please select a new timezone from the list above,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : ''} or 'cancel' to quit this process entirely without saving changes.`);
        return 'retry';
      }
      if (event.start) {
        const oldeventstart = event.start.format('YYYY-MM-DD[T]HH:mm:ss');
        [, tzString] = generateStartStr(moment.tz(oldeventstart, newTZ.locale));
      }
      else {
        [, tzString] = generateStartStr(moment().tz(newTZ.locale));
      }
      dmChannel.send({ content: `Ok, so you'd like to set the time zone for your event to **${tzString}**. Is this acceptable? **Y/N**\n*Note: Daylight savings will adjust based on any time change input in the next step.*` });
      YN = await promptYesNo(dmChannel, {
        messages: {
          no: `OK, please select a new timezone from the list above,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : ''} or 'cancel' to quit this process entirely without saving changes.`,
          cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
          invalid: `Reply not recognized! Please answer Y or N. Is **${tzString}** a good time zone for the event? **Y/N**`,
        },
      });
      if (YN !== false) {
        switch (YN.answer) {
        case true:
          return event;
        case false:
          return 'retry';
        }
      }
      else { return 'abort'; }
    });
    if (result === 'back') {
      return [event, true];
    }
    else if (!result) {
      return [event, 'cancel'];
    }
  }
  if (mode === 'edit') {
    // if newTZ exists, use that to generate the startStr.
    // otherwise  just use the extant event.start.
    if (newTZ) {
      const oldeventstart = event.start.format('YYYY-MM-DD[T]HH:mm:ss');
      [startStr, tzStr] = generateStartStr(moment.tz(oldeventstart, newTZ.locale));
    }
    else { [startStr, tzStr] = generateStartStr(event.start); }
    dmChannel.send({ content: `Current start time is **${startStr}**. Please note that this may have changed from what you expect if you changed the timezone. Would you like to change the date and time? **Y/N**` });
    YN = await promptYesNo(dmChannel, {
      messages: {
        no: 'Sounds good.',
        cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
        invalid: `Reply not recognized! Please answer Y or N. Current start time is **${startStr}**. Would you like to change the date and time? **Y/N**`,
      },
    });
    if (YN !== false) {
      switch (YN.answer) {
      case true:
        promptDate = true;
        break;
      case false:
        promptDate = false;
        break;
      }
    }
    else { return [event, 'cancel']; }
  }
  if (mode === 'new' || promptDate === true) {
    let tzString;
    if (event.start && newTZ) {
      const oldeventstart = event.start.format('YYYY-MM-DD[T]HH:mm:ss');
      newStart = moment.tz(oldeventstart, newTZ.locale);
      [, tzString] = generateStartStr(newStart);
    }
    else if (event.start && !newTZ) {
      [, tzString] = generateStartStr(event.start);
    }
    else {
      [, tzString] = generateStartStr(moment().tz(newTZ.locale));
    }
    dmChannel.send(`Great, please type a time and date for the event. Acceptable formats:
      > next Monday at 4pm
      > Tomorrow at 18:00
      > Now
      > In 3 hours
      > YYYY-MM-DD 2:00 PM
      > January 12th at 6:00
      > MM/DD/YYYY 13:00
      The date parser attempts to parse other formats, but the above are guaranteed to work.
      Notes:
      - This date will be set in the **${tzString}** time zone (but will adjust for DST if applicable).
      - Any date entered without AM/PM affixed will be treated as 24 hour time.`);
    const result = await promptForMessage(dmChannel, async (reply) => {
      const content = reply.content.trim();
      switch (content.toLowerCase()) {
      case 'back':
        if (mode === 'new') {
          dmChannel.send('Sorry, \'back\' is a keyword that can\'t be used here. Please enter a date, or \'cancel\' to quit this process.');
          return 'retry';
        }
        else {
          // reset temp vars and return
          newTZ = false;
          newStart = false;
          return true;
        }
      case 'cancel':
      case 'abort':
        dmChannel.send(`Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`);
        return 'abort';
      }
      const parsedDate = Sugar.Date.create(`${content}`, 'UTC');
      if (!parsedDate) {
        dmChannel.send(`Sorry, I couldn't parse that date. Please use one of the following formats:
        Monday at 4pm
        Tomorrow at 18:00
        Now
        In 3 hours
        YYYY-MM-DD 2:00 PM
        MM/DD/YYYY 13:00`);
        return 'retry';
      }
      const newLocale = (newTZ.locale || event.timezone);
      newStart = moment(parsedDate).tz(newLocale, true);
      [startStr, tzString] = generateStartStr(newStart);
      dmChannel.send(`Great! The start date will be **${startStr}**. Is this OK?  **Y/N**`);
      YN = await promptYesNo(dmChannel, {
        messages: {
          no: `OK, please type a new start date,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : ''} or 'cancel' to quit this process entirely without saving changes.`,
          cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
          invalid: `Reply not recognized! Please answer Y or N. Is **${startStr}** an acceptable start date for the event? **Y/N**`,
        },
      });
      if (YN !== false) {
        switch (YN.answer) {
        case true:
          return event;
        case false:
          return 'retry';
        }
      }
      else { return 'abort'; }
    });

    if (!result) {
      return [event, 'cancel'];
    }
    else {

      if (event.start && newTZ.locale && !newStart) {
        const oldeventstart = event.start.format('YYYY-MM-DD[T]HH:mm:ss');
        event.start = moment.tz(oldeventstart, newTZ.locale);
        event.timezone = newTZ.locale;
      }
      else if (newTZ.locale && newStart) {
        event.timezone = newTZ.locale;
        event.start = newStart;
      }
      else if (!newTZ.locale && newStart) {
        event.start = newStart;
      }

      return [event, true];
    }
  }
}

// TODO add step to reset repetition
async function dmPromptDuration(dmChannel, event, mode = 'new') {
  let replystr;
  switch(mode) {
  case 'edit':
    replystr = `Current event duration is ${event.duration > 0 ? `**${formatDurationStr(event.duration)}**.` : 'Instantaneous (no duration).'} please provide a duration for your event in the following format:`;
    break;
  case 'new':
    replystr = 'Please provide a duration for your event in the following format:';
    break;
  }
  replystr += `\n> Instantaneous / None / Skip (any of these will work)
  > 1 minute
  > 2.5 hours
  > 2 hours, 15 minutes
  > 1 day
  Note:
  - Differing units must be separated by a comma ("1 hour, 1 minute", etc).
  - Due to limitations of the event system, the duration will be rounded up to the nearest minute.`;
  dmChannel.send(replystr);
  const result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim();
    let durationMinutes = 0;
    let wrongArr = [];
    let YN = {};
    switch (content.toLowerCase()) {
    case 'back':
      if (mode === 'new') {
        dmChannel.send('Sorry, \'back\' is a keyword that can\'t be used here. Please enter a duration, or \'cancel\' to quit this process.');
        return 'retry';
      }
      else {
        return true;
      }
    case 'cancel':
    case 'abort':
      dmChannel.send(`Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`);
      return 'abort';
    case 'instantaneous':
    case 'skip':
    case 'none':
      break;
    default:
      [durationMinutes, wrongArr] = getDurationMinutes(content);
      if (durationMinutes === null || wrongArr.length > 0) {
        dmChannel.send(`Sorry, I didn't understand ${wrongArr.length > 0 ? `this part of your input: "${wrongArr.join(', ')}"!` : 'some part of your input!'} \
        Please ensure you use integer values, and separate units with a comma "1 hour, 30 minutes". Only days, hours, and minutes are accepted.`);
        return 'retry';
      }
      else if (durationMinutes > (24 * 60)) {
        dmChannel.send(`Sorry, your input totals out to ${formatDurationStr(durationMinutes)}, which is more than 1 day in length. Please enter a new duration, or ${mode === 'edit' ? ' \'back\' to return to the edit screen without changing anything,' : ''} or 'cancel' to quit this process without saving your event.`);
        return 'retry';
      }
    }
    dmChannel.send(`Great! The new duration will be **${durationMinutes > 0 ? formatDurationStr(durationMinutes) : 'Instantaneous'}**. Is this OK?  **Y/N**`);
    YN = await promptYesNo(dmChannel, {
      messages: {
        no: `OK, please type a new duration,${mode === 'edit' ? ' \'back\' to return to the edit screen without saving,' : '\'skip\' to skip this optional attribute,'} or 'cancel' to quit this process entirely without saving changes.`,
        cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
        invalid: `Reply not recognized! Please answer Y or N. Should the event duration be set to **${durationMinutes > 0 ? formatDurationStr(durationMinutes) : 'Instantaneous'}**? **Y/N**`,
      },
    });
    if (YN !== false) {
      switch (YN.answer) {
      case true:
        event.duration = durationMinutes;
        return event;
      case false:
        return 'retry';
      }
    }
    else { return 'abort'; }
  });
  if (!result) {
    return [event, 'cancel'];
  }
  else {
    return [event, true];
  }
}

async function dmPromptRecurrence(dmChannel, event, mode = 'new') {
  let result;
  let done = false;
  let newRuleOpts = null;
  let step = 'init';
  while (!done) {
    switch(step) {
    case 'init':
      ({ step, newRuleOpts, done } = await dmRecurInit(dmChannel, event, newRuleOpts, mode));
      break;
    case 'daily':
      ({ step, newRuleOpts, done } = await dmRecurDaily(dmChannel, event, newRuleOpts));
      break;
    case 'weekly':
      ({ step, newRuleOpts, done } = await dmRecurWeekly(dmChannel, event, newRuleOpts));
      break;
    case 'weeklybydays':
      ({ step, newRuleOpts, done } = await dmRecurWeeklyDays(dmChannel, event, newRuleOpts));
      break;
    case 'monthly':
      ({ step, newRuleOpts, done } = await dmRecurMonthly(dmChannel, event, newRuleOpts));
      break;
    case 'monthlybyweekdays':
      ({ step, newRuleOpts, done } = await dmRecurMonthlyWeekdays(dmChannel, event, newRuleOpts));
      break;
    case 'yearly':
      ({ step, newRuleOpts, done } = await dmRecurYearly(dmChannel, event, newRuleOpts));
      break;
    case 'recurcount':
      ({ step, newRuleOpts, done } = await dmRecurCount(dmChannel, event, newRuleOpts));
      break;
    case 'verify':
      ({ step, newRuleOpts, done } = await dmRecurVerify(dmChannel, event, newRuleOpts));
      break;
    default:
      break;
    }
  }
  if (done === true) {
    result = true;
  }
  else if (done === 'back') {
    result = true;
  }
  else if (done === 'abort') {
    result = false;
  }


  if (!result) {
    return [event, 'cancel'];
  }
  else {
    return [event, true];
  }
}

async function dmPromptAttOpts(dmChannel, event, mode = 'new') {
  let attOptStr = '';
  if (mode === 'edit') {
    for(const obj of event.attendanceOptions.values()) {
      attOptStr += `${obj.emoji} - ${obj.description}\n`;
    }
  }
  const embed = new MessageEmbed()
    .setTitle('Which emoji should be used for signing up?')
    .setDescription(`**1.** ✅ Accept, ❓ Maybe, ❌ Decline
      **2.** ✅ Accept, ❌ Decline
      **3.** Custom
      ${mode === 'edit' ? `Current attentdance options are:\n${attOptStr}` : ''}`)
    .setFooter({ text: `Enter a number to select an option. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'` });
  dmChannel.send({ embeds: [embed] });
  const result = await promptForMessage(dmChannel, async (reply) => {
    let content = reply.content.trim().toLowerCase();
    if (Number(content)) {
      content = Number(content);
    }
    let emojiMap = new Map();
    switch(content) {
    case 1:
      emojiMap.set(1, { emoji: '✅', description: 'Accept' });
      emojiMap.set(2, { emoji: '❓', description: 'Maybe' });
      emojiMap.set(3, { emoji: '❌', description: 'Decline' });
      event.attendanceOptions = emojiMap;
      return true;
    case 2:
      emojiMap.set(1, { emoji: '✅', description: 'Accept' });
      emojiMap.set(2, { emoji: '❌', description: 'Decline' });
      event.attendanceOptions = emojiMap;
      return true;
    case 3:
      emojiMap = await dmCustomAttOpt(dmChannel, event, mode);
      if (emojiMap == 'retry') {
        dmChannel.send({ embeds: [embed] });
        return 'retry';
      }
      else if (!emojiMap) {
        return 'abort';
      }
      else {
        event.attendanceOptions = emojiMap;
        return true;
      }
    case 'cancel':
    case 'abort':
      return 'abort';
    case 'back':
      if (mode === 'edit') {
        return 'back';
      }
      // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Enter a number to select an option. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  if (!result) {
    return [event, 'cancel'];
  }
  else {
    return [event, true];
  }
}

async function dmCustomAttOpt(dmChannel, event, mode) {
  let eMap = new Map();
  dmChannel.send(`Ok, a custom set of emoji. I can include up to 3. This bot can use custom emoji from any server that it is a member of.
  Note: If you do not have discord nitro, but want to use custom emoji, you must convert it to discord markup.
  Type **info** if you need information on how to do this.  You may also type **back** to return to the non-custom emoji options.
  **Otherwise, please type up to 3 emoji separated by a comma.**  An optional description for each emoji can be set up next.`);
  const result = await promptForMessage(dmChannel, async (reply) => {
    // reply handling part 1, handle special options
    const content = reply.content.trim();
    if (content.toLowerCase() === 'info') {
      dmChannel.send(`In the backend of discord, non-standard emojis are formatted in the following way:
      \`<:emojiname:123456789>\` for static emoji, and
      \`<a:emojiname:123456789>\` for animated emoji; in both cases '123456789' is the snowflake id of the emoji.
      An easy way to convert an emoji to this format is to type \`\\:emojiname:\` in a server you can post the emoji and **send it**.
      The output into the text channel will be the discord markup format. 
      You can also extract the emoji ID by hand by right clicking a posted emoji and choosing "open link".
      REMEMBER: THIS BOT MUST BE ABLE TO SEE THE EMOJI TO POST IT, and therefore must be in the server you select an emoji from.
      Now, **Please type up to 3 emoji separated by a comma.**`);
      return 'retry';
    }
    else if (content.toLowerCase() === 'back') {
      return 'back';
    }
    else if (content.toLowerCase() === 'cancel' || content.toLowerCase() === 'abort') {
      return false;
    }
    // reply handling - trim extraneous spaces and split to array at commas.
    const emojiArr = content.split(',');
    emojiArr.forEach((str, i) =>{
      emojiArr[i] = str.trim();
    });
    if(emojiArr.length > 3) {
      dmChannel.send('I\'m sorry, that was too many items! Please type only 3 emoji, separated by commas.');
      return 'retry';
    }
    else if (emojiArr.length > 0) {
      const invalidEntries = [];
      for (const [i, eStr] of emojiArr.entries()) {
        const emoji = await validateEmoji(dmChannel.client, eStr);
        if (emoji) {
          emojiArr[i] = emoji;
        }
        else {
          invalidEntries.push(eStr);
        }
      }
      if (invalidEntries.length > 0) {
        dmChannel.send(`I'm sorry, the following items in your list of emoji were invalid:
        ${invalidEntries.join(', ')}
        Either this bot is not in a server that has those emoji, or they are not valid emoji.
        Please type up to 3 emoji separated by a comma, 'back' to return to the standard emoji options, or 'abort' to cancel this wizard and lose all changes.`);
        return 'retry';
      }
      else {
        dmChannel.send(`Great! The emoji for this event will be ${emojiArr.join(', ')}. Is this OK?  **Y/N**`);
        let YN = await promptYesNo(dmChannel, {
          messages: {
            no: 'OK, Please type up to 3 emoji separated by a comma, \'back\' to return to the standard emoji options, or \'abort\' to cancel this wizard and lose all changes.',
            cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
            invalid: `Reply not recognized! Please answer Y or N. The emoji for this event will be ${emojiArr.join(', ')}. Is this OK?  **Y/N**`,
          },
        });
        if (YN !== false) {
          switch (YN.answer) {
          case true:
            break;
          case false:
            return 'retry';
          }
        }
        else { return 'abort'; }
        dmChannel.send('Would you like to set a description for these emoji? For example \'✅ - Accept\' **Y/N**');
        YN = await promptYesNo(dmChannel, {
          messages: {
            no: 'OK, great.',
            cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
            invalid: 'Reply not recognized! Please answer Y or N. Would you like to set a description for these emoji? For example \'✅ - Accept\' **Y/N**',
          },
        });
        if (YN !== false) {
          switch (YN.answer) {
          case true:
            eMap = await dmCustomAttOptDesc(dmChannel, event, emojiArr, mode);
            return eMap;
          case false:
            eMap.clear();
            emojiArr.map((emoji, idx) => {
              eMap.set(idx + 1, { emoji: emoji, description: '' });
            });
            return eMap;
          }
        }
        else { return 'abort'; }
      }
    }
  });
  if (result === 'back') {
    return 'retry';
  }
  else { return result; }
}

async function dmCustomAttOptDesc(dmChannel, event, emojiArr, mode = 'new') {
  let done = false;
  const descArr = [];
  let YN = {};
  dmChannel.send('We will go through each emoji one by one.');
  while (!done) {
    for (const [i, emoji] of emojiArr.entries()) {
      dmChannel.send(`What would you like the description of ${emoji} to be? No more than 15 characters.  You may also enter 'none' to have no description for this particular entry.`);
      const result = await promptForMessage(dmChannel, async (reply) => {
        const content = reply.content.trim();
        if (content.length > 15) {
          dmChannel.send(`Description must be 15 characters or less.  Please enter a description for ${emoji},'none' to have no description, or 'cancel' to quit this process entirely without saving changes.`);
          return 'retry';
        }
        switch(content.toLowerCase()) {
        case 'back':
          dmChannel.send('Sorry, \'back\' is a keyword that can\'t be used here. Please enter a new name, or \'cancel\' to quit this process.');
          return 'retry';
        case 'cancel':
        case 'abort':
          dmChannel.send(`Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`);
          return 'abort';
        case 'none':
          dmChannel.send(`Great! No description for ${emoji}. Is this OK?  **Y/N**`);
          YN = await promptYesNo(dmChannel, {
            messages: {
              no: `OK, please type a new description of ${emoji}, 'none', or 'cancel' to quit this process entirely without saving changes.`,
              cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
              invalid: `Reply not recognized! Please answer Y or N. No description for ${emoji}. Is this OK? **Y/N**`,
            },
          });
          if (YN !== false) {
            switch (YN.answer) {
            case true:
              descArr[i] = '';
              return true;
            case false:
              return 'retry';
            }
          }
          else { return 'abort'; }
          break;
        default:
          dmChannel.send(`Great! The description will be **${content}**. Is this OK?  **Y/N**`);
          YN = await promptYesNo(dmChannel, {
            messages: {
              no: `OK, please type a new description of ${emoji}, 'none', or 'cancel' to quit this process entirely without saving changes.`,
              cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
              invalid: `Reply not recognized! Please answer Y or N. Is **${content}** an acceptable name for the event? **Y/N**`,
            },
          });
          if (YN !== false) {
            switch (YN.answer) {
            case true:
              return descArr[i] = content;
            case false:
              return 'retry';
            }
          }
          else { return 'abort'; }
        }
      });
      if (!result) {return false;}
    }
    let attOptStr = '';
    for (const [i, emoji] of emojiArr.entries()) {
      attOptStr += `${emoji}${descArr[i] ? ` - ${descArr[i]}` : ' - (no description)'}\n`;
    }
    attOptStr = attOptStr.trim();
    dmChannel.send(`Great! Your emoji and their descriptions are:
    ${attOptStr}.
    Does this look OK to you?`);
    YN = await promptYesNo(dmChannel, {
      messages: {
        cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
        invalid: `Reply not recognized! Please answer Y or N. Your emoji and their descriptions are:
        ${attOptStr}.
        Does this look OK to you? **Y/N**`,
      },
    });
    if (YN !== false) {
      switch (YN.answer) {
      case true:
        done = true;
        break;
      case false:
        break;
      }
    }
    else { return false; }
  }
  const eMap = new Map();
  for (const [i, emoji] of emojiArr.entries()) {
    eMap.set(i + 1, { emoji: emoji, description: descArr[i] });
  }
  return eMap;
}

async function dmPromptRole(dmChannel, event, mode = 'new') {
  console.log('roles are not yet settable at this time');
  return [event, true];
}
async function dmPromptAutoDelete(dmChannel, event, mode = 'new') {
  console.log('roles are not yet settable at this time');
  return [event, true];
}

async function dmRecurInit(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  const embed = new MessageEmbed()
    .setTitle('How often should this event recur?')
    .setDescription(`**1** Daily
    **2** Every *#* of days
    **3** Weekly
    **4** Every *#* of weeks
    **5** Monthly on the ${event.start.format('Do')} of the month 
    \\*(note, months without this date will be skipped)
    **6** Monthly by weekday (1st Monday, etc)
    **7** Yearly
    **8** None`)
    .setFooter({ text: `Enter a number to select an option. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'` });
  dmChannel.send({ embeds: [embed] });
  const result = await promptForMessage(dmChannel, async (reply) => {
    let content = reply.content.trim().toLowerCase();
    if (Number(content)) {
      content = Number(content);
    }
    switch(content) {
    case 1:
      newRuleOpts = {
        dtstart: new Date(eventstart.tz('UTC', true)),
        freq: RRule.DAILY,
        interval: 1,
      };
      return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
    case 2:
      return { step: 'daily', newRuleOpts: newRuleOpts, done: false };
    case 3:
      newRuleOpts = {
        dtstart: new Date(eventstart.tz('UTC', true)),
        freq: RRule.WEEKLY,
        interval: 1,
      };
      return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
    case 4:
      return { step: 'weekly', newRuleOpts: newRuleOpts, done: false };
    case 5:
      return { step: 'monthly', newRuleOpts: newRuleOpts, done: false };
    case 6:
      return { step: 'monthlybyweekdays', newRuleOpts: newRuleOpts, done: false };
    case 7:
      return { step: 'yearly', newRuleOpts: newRuleOpts, done: false };
    case 8:
      return { step: 'verify', newRuleOpts: null, done: false };
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Enter a number to select an option. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  return result;
}

async function dmRecurDaily(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  dmChannel.send('Ok, how many days between recurrences? (Max 366)');
  const result = await promptForMessage(dmChannel, async (reply) => {
    let content = reply.content.trim().toLowerCase();
    if (Number(content)) {
      content = Number(content);
      if (content > 367) {
        newRuleOpts = {
          dtstart: new Date(eventstart.tz('UTC', true)),
          freq: RRule.DAILY,
          interval: content,
        };
        return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
      }
      else {
        dmChannel.send(`Sorry, the maximum length between daily recurrences is 366 days.  Please use a different type of recurrence for longer periods. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      }
    }
    switch(content) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Please reply with only a number. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  return result;
}

async function dmRecurWeekly(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  dmChannel.send('Ok, how many weeks between recurrences? (Max 80)');
  const result = await promptForMessage(dmChannel, async (reply) => {
    let content = reply.content.trim().toLowerCase();
    if (Number(content)) {
      content = Number(content);
      if (content > 80) {
        newRuleOpts = {
          dtstart: new Date(eventstart.tz('UTC', true)),
          freq: RRule.WEEKLY,
          interval: content,
        };
        return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
      }
      else {
        dmChannel.send(`Sorry, the maximum length between weekly recurrences is 80 weeks (1.5 years).  Please use monthly or annual recurrence for longer periods. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      }
    }
    switch(content) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Please reply with only a number. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  return result;
}

async function dmRecurWeeklyDays(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  const embed = new MessageEmbed()
    .setTitle('On which days of the week should this event recur?')
    .setDescription(`**1** Sunday
    **2** Monday
    **3** Tuesday
    **4** Wednesday
    **5** Thursday
    **6** Friday
    **7** Saturday`)
    .setFooter({ text: `Enter a number to select an option, or multiple numbers separated by a space ('1 3 5' for Su/Tu/Th recurrence) . ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'` });
  dmChannel.send({ embeds: [embed] });
  let result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim().toLowerCase();
    const noParseArr = [];
    const weekdayArr = [];
    for(const str of content.split(' ')) {
      let num;
      if (parseInt(str)) {
        num = parseInt(str);
        switch(num) {
        case 1:
          weekdayArr.push(RRule.SU);
          break;
        case 2:
          weekdayArr.push(RRule.MO);
          break;
        case 3:
          weekdayArr.push(RRule.TU);
          break;
        case 4:
          weekdayArr.push(RRule.WE);
          break;
        case 5:
          weekdayArr.push(RRule.TH);
          break;
        case 6:
          weekdayArr.push(RRule.FR);
          break;
        case 7:
          weekdayArr.push(RRule.SA);
          break;
        default:
          noParseArr.push(str);
          break;
        }
      }
      else {noParseArr.push(str);}
    }
    if (noParseArr.length === 0) {
      newRuleOpts = {
        dtstart: new Date(eventstart.tz('UTC', true)),
        freq: RRule.WEEKLY,
        byweekday: weekdayArr,
      };
      return { step: null, newRuleOpts: newRuleOpts, done: false };
    }
    switch(content) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`${noParseArr.length > 0 ? `I couldn't understand *${noParseArr.join(', ')}*! ` : '' }Enter a number to select an option, or multiple numbers separated by a space. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  // then if newRuleOpts has been set and the done var hasn't, ask for a number of weeks to recur on.
  if (result.newRuleOpts && !result.done) {
    dmChannel.send('Ok, how many weeks between recurrences? (Max 80)');
    result = await promptForMessage(dmChannel, async (reply) => {
      let content = reply.content.trim().toLowerCase();
      if (Number(content)) {
        content = Number(content);
        if (content > 80) {
          newRuleOpts = {
            dtstart: new Date(eventstart.tz('UTC', true)),
            freq: RRule.WEEKLY,
            interval: content,
          };
          return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
        }
        else {
          dmChannel.send(`Sorry, the maximum length between weekly recurrences is 80 weeks (1.5 years).  Please use monthly or annual recurrence for longer periods. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
        }
      }
      switch(content) {
      case 'cancel':
        return { step: null, newRuleOpts: null, done: 'abort' };
      case 'back':
        if (mode === 'edit') {
          return { step: null, newRuleOpts: null, done: 'back' };
        }
        // eslint-disable-next-line no-fallthrough
      default:
        dmChannel.send(`Please reply with only a number. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
        return 'retry';
      }
    });
    return result;
  }
  return result;
}

async function dmRecurMonthly(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  dmChannel.send(`Ok, the ${event.start.format('Do')} of every month. how many months between recurrences? (Max 24)\nNOTE: If this event is scheduled on the 29th, 30th, or 31st of the month, any month without these days will be skipped when calculating recurrence.`);
  const result = await promptForMessage(dmChannel, async (reply) => {
    let content = reply.content.trim().toLowerCase();
    if (Number(content)) {
      content = Number(content);
      if (content > 24) {
        newRuleOpts = {
          dtstart: new Date(eventstart.tz('UTC', true)),
          freq: RRule.MONTHLY,
          interval: content,
        };
        return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
      }
      else {
        dmChannel.send(`Sorry, the maximum length between monthly recurrences is 24 months (2 years).  Please use monthly or annual recurrence for longer periods. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      }
    }
    switch(content) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Please reply with only a number. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  return result;
}

async function dmRecurMonthlyWeekdays(dmChannel, event, newRuleOpts, mode) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  const weekdayArr = [];
  let embed = new MessageEmbed()
    .setTitle('Which days of the week should this event recur on?')
    .setDescription(`Pattern ('nth weekday of month) will be selected in the next step.
      **1** Sunday
      **2** Monday
      **3** Tuesday
      **4** Wednesday
      **5** Thursday
      **6** Friday
      **7** Saturday`)
    .setFooter({ text: `Enter a number to select an option, or multiple numbers separated by a space ('1 3 5' for Su/Tu/Th recurrence) . ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'` });
  dmChannel.send({ embeds: [embed] });
  let result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim().toLowerCase();
    const noParseArr = [];
    for(const str of content.split(' ')) {
      let num;
      if (parseInt(str)) {
        num = parseInt(str);
        switch(num) {
        case 1:
          weekdayArr.push(RRule.SU);
          break;
        case 2:
          weekdayArr.push(RRule.MO);
          break;
        case 3:
          weekdayArr.push(RRule.TU);
          break;
        case 4:
          weekdayArr.push(RRule.WE);
          break;
        case 5:
          weekdayArr.push(RRule.TH);
          break;
        case 6:
          weekdayArr.push(RRule.FR);
          break;
        case 7:
          weekdayArr.push(RRule.SA);
          break;
        default:
          noParseArr.push(str);
          break;
        }
      }
      else {noParseArr.push(str);}
    }
    if (noParseArr.length === 0) {
      newRuleOpts = {
        dtstart: new Date(eventstart.tz('UTC', true)),
        freq: RRule.WEEKLY,
        bymonthday: [],
      };
      return { step: null, newRuleOpts: newRuleOpts, done: false };
    }
    switch(content) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
      // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`${noParseArr.length > 0 ? `I couldn't understand *${noParseArr.join(', ')}*! ` : '' }Enter a number to select an option, or multiple numbers separated by a space. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
    // then if newRuleOpts has been set and the done var hasn't, ask for a number of weeks to recur on.
  if (result.newRuleOpts && !result.done) {
    const ruleArr = [];
    const dayArr = [];
    for (const dayRule of weekdayArr) {
      switch(dayRule) {
      case RRule.MO:
        dayArr.push('Monday');
        break;
      case RRule.TU:
        dayArr.push('Tuesday');
        break;
      case RRule.WE:
        dayArr.push('Wednesday');
        break;
      case RRule.TH:
        dayArr.push('Thursday');
        break;
      case RRule.FR:
        dayArr.push('Friday');
        break;
      case RRule.SA:
        dayArr.push('Saturday');
        break;
      case RRule.SU:
        dayArr.push('Sunday');
        break;
      }
    }
    embed = new MessageEmbed()
      .setTitle('Which monthly pattern should this event recur on?')
      .setDescription(`**1** First ${dayArr.join(', ')}
      **2** Second ${dayArr.join(', ')}
      **3** Third ${dayArr.join(', ')}
      **4** Fourth ${dayArr.join(', ')}
      **5** Last ${dayArr.join(', ')}`)
      .setFooter({ text: `Enter a number to select an option, or multiple numbers separated by a space ('1 3 5' for Su/Tu/Th recurrence) . ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'` });
    dmChannel.send({ embeds: [embed] });
    result = await promptForMessage(dmChannel, async (reply) => {
      const noParseArr = [];
      const content = reply.content.trim();
      for(const str of content.split(' ')) {
        let num;
        if (parseInt(str)) {
          num = parseInt(str);
          switch(num) {
          case 1:
          case 2:
          case 3:
          case 4:
            weekdayArr.forEach(v => {
              ruleArr.push(v.nth(num));
            });
            break;
          case 5:
            weekdayArr.forEach(v => {
              ruleArr.push(v.nth(-1));
            });
            break;
          default:
            noParseArr.push(str);
            break;
          }
        }
        else {noParseArr.push(str);}
      }
      if (noParseArr.length === 0) {
        newRuleOpts = {
          dtstart: new Date(eventstart.tz('UTC', true)),
          freq: RRule.MONTHLY,
          bymonthday: [],
          byweekday: ruleArr,
        };
        return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
      }
      switch(content) {
      case 'cancel':
        return { step: null, newRuleOpts: null, done: 'abort' };
      case 'back':
        if (mode === 'edit') {
          return { step: null, newRuleOpts: null, done: 'back' };
        }
        // eslint-disable-next-line no-fallthrough
      default:
        dmChannel.send(`Please reply with only a number. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
        return 'retry';
      }
    });
    return result;
  }
  return result;
}


async function dmRecurYearly(dmChannel, event, newRuleOpts) {
  // shallow copy since .tz() modifies the original object.
  const eventstart = moment({ ...event.start });
  dmChannel.send(`Ok, every year on ${eventstart.format('MMMM Do')}.`);
  newRuleOpts = {
    dtstart: new Date(eventstart.tz('UTC', true)),
    freq: RRule.YEARLY,
    interval: 1,
  };
  return { step: 'recurcount', newRuleOpts: newRuleOpts, done: false };
}

async function dmRecurCount(dmChannel, event, newRuleOpts, mode) {
  const tempRule = new RRule(newRuleOpts);
  dmChannel.send(`Great. Your rule is currently **${tempRule.toText}**.
  How many times would you like it to recur?
  You may answer either with a plain number (1-50), or a date/time.`);
  const result = await promptForMessage(dmChannel, async (reply) => {
    const content = reply.content.trim();
    if (Number(content)) {
      const num = parseInt(Number(content));
      if (num > 0 && num <= 50) {
        newRuleOpts.count = num;
        return { step: 'verify', newRuleOpts: newRuleOpts, done: false };
      }
      else {
        dmChannel.send(`Sorry, I interpreted that as ${num}; maximum recurrence count is 50.\
        You can always revisit this and modify your recurrence when the final recurrence is closer.`);
        return 'retry';
      }
    }
    const parsedDate = Sugar.Date.create(`${content}`, 'UTC');
    if (parsedDate) {
      newRuleOpts.until = new Date(parsedDate);
      return { step: 'verify', newRuleOpts: newRuleOpts, done: false };
    }
    switch(content.toLowerCase()) {
    case 'cancel':
      return { step: null, newRuleOpts: null, done: 'abort' };
    case 'back':
      if (mode === 'edit') {
        return { step: null, newRuleOpts: null, done: 'back' };
      }
    // eslint-disable-next-line no-fallthrough
    default:
      dmChannel.send(`Sorry, I couldn't parse that as a number or a date. Acceptable date formats:
      Next Monday
      Tomorrow
      YYYY-MM-DD
      MM/DD/YYYY
      et cetera. ${mode === 'edit' ? 'To return to the edit screen type \'back\'.' : ''} To exit, type 'cancel'`);
      return 'retry';
    }
  });
  return result;
}
async function dmRecurVerify(dmChannel, event, newRuleOpts, mode) {
  let tempRule = null;
  if (newRuleOpts) {
    tempRule = new RRule(newRuleOpts);
  }
  // shallow copy since .tz() modifies the original object.
  dmChannel.send(`Great! Your event recurrence will be **${tempRule ? tempRule.toText() : 'No Recurrence'}**. Is this OK?  **Y/N**`);
  const YN = await promptYesNo(dmChannel, {
    messages: {
      yes: 'Excellent. Recurrence set.',
      cancel: `Event ${mode === 'edit' ? 'editing' : 'creation'} cancelled. Please perform the command again to restart this process.`,
      invalid: `Reply not recognized! Please answer Y or N. Is **${tempRule ? tempRule.toText() : 'No Recurrence'}** acceptable? **Y/N**`,
    },
  });
  if (YN !== false) {
    switch (YN.answer) {
    case true:
      event.recurrence = tempRule;
      return { step: null, newRuleOpts: null, done: true };
    case false:
      return { step: 'init', newRuleOpts: null, done: false };
    }
  }
  else { return { step: null, newRuleOpts: null, done: 'abort' }; }
}

/**
 * Convert a duration string like '1 hour, 2 minutes' into a number of minutes.
 * @param {String} string
 * @returns {Array [Number, Array]} Durations in integer numbers or null if input string was invalid. WrongArr contains all substrings that were unparsable.
 */
function getDurationMinutes(string) {
  const regex = new RegExp(/((?<days>\d+(.\d+)?) days*)?((?<hours>\d+(.\d+)?) hours*)?((?<minutes>\d+(.\d+)?) minutes*)?((?<seconds>\d+(.\d+)?) seconds*)?/);
  // split the input string into substrings at commas.
  const arr = string.split(', ');
  const durObj = {};
  const wrongArr = [];
  // iterate through the substrings and get days, hours, minutes, seconds.
  for (const s of arr) {
    // since s.match(regex).groups includes null groups, filter those out.
    const match = Object.fromEntries(Object.entries(s.match(regex).groups).filter(([, v]) => v != null));
    // if match is an empty obj, that means this substring was unparsable. add it to the arr of wrong substrings.
    if (Object.keys(match).length === 0) {
      wrongArr.push(s);
    }
    Object.assign(durObj, match);
  }
  if (Object.keys(durObj).length > 0) {
    // convert strings in keys to numbers.
    Object.keys(durObj).forEach(k => {
      durObj[k] = Number(durObj[k]);
    });
    // in-fill empty keys so next step doesn't return NaN
    ['days', 'hours', 'minutes', 'seconds'].forEach(prop => {
      if(!durObj.hasOwnProperty(prop)) {
        durObj[prop] = null;
      }
    });
    // then convert to minutes; round any partial minutes up.
    const minutes = Math.ceil((durObj.days * 24 * 60) + (durObj.hours * 60) + durObj.minutes + (durObj.seconds * (1 / 60)));
    return [minutes, wrongArr];
  }
  else { return [null, wrongArr]; }
}

// find an event by its interaction ID.
async function getEventByPost(interaction) {
  const guildData = interaction.client.eventData.get(interaction.guild.id);
  for (const [, e] of guildData.events) {
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
  if (event.duration > 0) {
    eventend = moment(event.start).add(parseInt(event.duration), 'minutes');
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
    .addFields({ name: 'Time', value: `${discordMomentFullDate(event.start)}${eventend ? `- ${discordMomentShortTime(eventend)}\n(${formatDurationStr(event.duration)})` : ''} ⌚${discordMomentRelativeDate(event.start)}` })
    .setFooter({ text: `Created by ${event.organizer.displayName} · ${formatRecurrenceStr(event)}`, iconURL: event.organizer.displayAvatarURL() });
  for (const [, opts] of event.attendanceOptions) {
    const memberArr = attendeeMap.get(opts.emoji);
    const fieldVal = [];
    if (memberArr) {
      for (const member of memberArr) {
        fieldVal.push(member.displayName);
      }
    }
    else {fieldVal.push('-');}
    embed.addField(`${opts.emoji}${opts.description ? ` - ${opts.description}` : ''}`, fieldVal.join('\n'), true);
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
  interaction.deferReply();
  const dmChannel = await interaction.user.createDM();
  let newEvent = new Event();
  newEvent.organizer = interaction.member;
  newEvent.id = (Date.now().toString(10) + (Math.random() * 9999).toFixed(0).toString(10).padStart(4, '0'));
  newEvent.channel = interaction.options.getChannel('channel') || interaction.channel;
  try {
    await dmChannel.send({ content: 'OK! Starting event creation.' });
  }
  catch(err) {
    if (err.message == 'Cannot send messages to this user') {
      interaction.followUp({ content: 'Sorry, I can\'t seem to DM you. Please make sure that your privacy settings allow you to recieve DMs from this bot.', ephemeral: true });
      return false;
    }
    else {
      interaction.followUp({ content: 'There was an error sending you a DM! Please check your privacy settings.  If your settings allow you to recieve DMs from this bot, check the console for full error review.', ephemeral:true });
      console.log(err);
      return false;
    }
  }
  let result;
  let i = 1;
  let createLoop = true;
  let editEmbed;
  let editloop = false;
  while (createLoop) {
    switch(i) {
    case 1:
      [newEvent, result] = await dmPromptEventName(dmChannel, newEvent, 'new');
      break;
    case 2:
      [newEvent, result] = await dmPromptEventDescription(dmChannel, newEvent, 'new');
      break;
    case 3:
      [newEvent, result] = await dmPromptStart(dmChannel, newEvent, 'new');
      break;
    case 4:
      [newEvent, result] = await dmPromptDuration(dmChannel, newEvent, 'new');
      break;
    case 5:
      [newEvent, result] = await dmPromptRecurrence(dmChannel, newEvent, 'new');
      break;
    case 6:
      [newEvent, result] = await dmPromptAttOpts(dmChannel, newEvent, 'new');
      break;
    case 7:
      [newEvent, result] = await dmPromptRole(dmChannel, newEvent, 'new');
      break;
    case 8:
      [newEvent, result] = await dmPromptAutoDelete(dmChannel, newEvent, 'new');
      break;
    case 9:
      // at this point we should have a finished event.
      if (result && result !== 'cancel') {
        const { embeds } = await generatePost(newEvent);
        await dmChannel.send({ content: 'OK, done. Here is your new event. Does this look good? **Y/N** (You will be given an opportunity to edit the event if you answer no.) \n***Your edits will not be saved until you answer \'Yes\'***', embeds: embeds });
        let YN = await promptYesNo(dmChannel, {
          messages: {
            no: 'OK. Would you like to edit the event? **Y** to edit, **N** to cancel',
            cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
            invalid: 'Reply not recognized! Please answer Y or N. Does the above event look acceptable? **Y/N**.',
          },
        });
        if (YN !== false) {
          switch (YN.answer) {
          case true:
            createLoop = false;
            result = 'save';
            break;
          case false:
            // if they say no to the previous, we asked if they'd like to edit the event.
            YN = await promptYesNo(dmChannel, {
              messages: {
                no: 'Event creation cancelled. Please perform the command again to restart this process.',
                cancel: 'Event creation cancelled. Please perform the command again to restart this process.',
                invalid: 'Reply not recognized! Please answer Y or N. Would you like to edit the event? **Y/N**.',
              },
            });
            if (!YN || !YN.answer) {
              interaction.followUp({ content: 'Event editing cancelled!', ephemeral: true });
              return false;
            }
            editEmbed = generateEditEmbed(newEvent);
            try {
              await dmChannel.send({ content: 'You may type \'cancel\' at any point in this process to abort without saving your changes.', embeds: [editEmbed] });
            }
            catch(err) {
              if (err.message == 'Cannot send messages to this user') {
                interaction.followUp({ content: 'Sorry, I can\'t seem to DM you. Please make sure that your privacy settings allow you to recieve DMs from this bot.', ephemeral: true });
                return false;
              }
              else {
                interaction.followUp({ content: 'There was an error sending you a DM! Please check your privacy settings.  If your settings allow you to recieve DMs from this bot, check the console for full error review.', ephemeral:true });
                console.log(err);
                return false;
              }
            }
            result = await promptForMessage(dmChannel, async (reply) => {
              // response here should be simple - 1 through 8.
              const content = reply.content.trim();
              if (!(Number(content) > 0 && Number(content) <= 8)) {
                switch(content.toLowerCase()) {
                case 'cancel':
                case 'abort':
                  dmChannel.send('Event creation cancelled. Please edit the event again to restart the process.');
                  return 'abort';
                default:
                  dmChannel.send('I\'m sorry, I didn\'t understand that.  Please only respond with a number from 1 to 8, or \'cancel\' to cancel.');
                  return 'retry';
                }
              }
              else { return parseInt(Number(content)); }
            });

            if (!result) { editloop = false; }

            while (editloop) {
              switch (result) {
              case 1:
                [newEvent, result] = await dmPromptEventName(dmChannel, newEvent, 'edit');
                break;
              case 2:
                [newEvent, result] = await dmPromptEventDescription(dmChannel, newEvent, 'edit');
                break;
              case 3:
                [newEvent, result] = await dmPromptStart(dmChannel, newEvent, 'edit');
                break;
              case 4:
                [newEvent, result] = await dmPromptDuration(dmChannel, newEvent, 'edit');
                break;
              case 5:
                [newEvent, result] = await dmPromptRecurrence(dmChannel, newEvent, 'edit');
                break;
              case 6:
                [newEvent, result] = await dmPromptAttOpts(dmChannel, newEvent, 'edit');
                break;
              case 7:
                [newEvent, result] = await dmPromptRole(dmChannel, newEvent, 'edit');
                break;
              case 8:
                [newEvent, result] = await dmPromptAutoDelete(dmChannel, newEvent, 'edit');
                break;
              }
              if (result && result !== 'cancel') {
                editEmbed = generateEditEmbed(newEvent);
                await dmChannel.send({ content: 'OK, done. Here is your new event. Please select an item, or type \'done\' to save your edits. \n***Your edits will not be saved until you type \'done\'***', embeds: [editEmbed] });
                result = await promptForMessage(dmChannel, async (reply) => {
                  // response here should be simple - 1 through 8.
                  const content = reply.content.trim();
                  if (!(Number(content) > 0 && Number(content) <= 8)) {
                    switch(content.toLowerCase()) {
                    case 'cancel':
                    case 'abort':
                      dmChannel.send('Event creation cancelled. Please edit the event again to restart the process.');
                      return 'abort';
                    case 'done':
                    case 'save':
                      dmChannel.send('Great! I will save your event and post it.');
                      return 'save';
                    default:
                      dmChannel.send('I\'m sorry, I didn\'t understand that.  Please only respond with a number from 1 to 8, or \'cancel\' to cancel.');
                      return 'retry';
                    }
                  }
                  else { return parseInt(Number(content)); }
                });
              }
              if (!result || result === 'save' || result === 'cancel') { editloop = false; }
            }
            if (result === 'save') { newEvent; }
            else {
              interaction.followUp({ content: 'Event editing cancelled!', ephemeral: true });
              return false;
            }
          }
        }
        else {
          interaction.followUp({ content: 'Event editing cancelled!', ephemeral: true });
          return false;
        }
      }
      break;
    }
    if (!result || result === 'cancel') {
      createLoop = false;
      newEvent = null;
    }
    i++;
  }
  if (newEvent) {
    const config = getConfig(interaction.client, interaction.guildId);
    let eventInfoChannel;
    try {eventInfoChannel = await interaction.client.channels.fetch(config.eventInfoChannelId);}
    catch {eventInfoChannel = null;}
    let newPost;
    if (eventInfoChannel && eventInfoChannel.id != newEvent.channel.id) {
      const newEvtChnPost = await postEventEmbed(newEvent, eventInfoChannel);
      newEvent.posts.set(newEvtChnPost.id, newEvtChnPost);
    }

    if (newEvent.channel.id == interaction.channel.id) {
      const msgPayload = await generatePost(newEvent);
      newPost = await interaction.editReply(msgPayload);
    }
    else {
      newPost = await postEventEmbed(newEvent, newEvent.channel);
      await interaction.editReply({ content: `Your event has been posted in ${newEvent.channel.id}`, ephemeral: true });
    }
    newEvent.posts.set(newPost.id, newPost);
    await eventManager.set(newEvent);
  }
  else {await interaction.editReply({ content: 'Event creation cancelled!', ephemeral: true });}
}

module.exports = {
  guildOnly: true,
  staffOnly: false,
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
        .setDescription('cancel an event'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('tz')
        .setDescription('test posting tz embed')),
  async execute(interaction) {
    const subCommand = interaction.options.getSubcommand();
    switch(subCommand) {
    case 'create':
      await createEvent(interaction);
      break;
    /* case 'tz':
      interaction.reply({ embeds: [TZEMBED] });
      break; */
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
          console.log(`No event info channel set for ${g.id} / ${g.name}, skipping.`);
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
      if (!(interaction.isButton() && interaction.customId.startsWith('event'))) return;
      if (!await getEventByPost(interaction)) {
        const newRows = [];
        interaction.message.components.forEach(row => {
          for(let i = 0; i < (row.components.length); i++) {
            row.components[i].setDisabled(true);
          }
          newRows.push(row);
        });
        //  console.log(interaction.message);
        interaction.message.edit({ embeds: interaction.message.embeds, components: newRows });
        return interaction.reply({ content: 'Sorry, that event is over!  I will disable the buttons.', ephemeral: true });
      }
      await interaction.deferUpdate();
      // handle event creation buttons.
      switch (interaction.customId.substring(0, 15)) {
      case 'eventEdit':
        await editEventButton(interaction);
        break;
      case 'eventDelete':
        await deleteEventButton(interaction);
        break;
      case 'eventAttendance':
        await updateAttendanceButton(interaction);
        break;
      default:
        break;
      }
    });
  },
};
