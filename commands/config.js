// initializing configurable parts of config.json
// current varTypes are boolean, integer, channel, role, channelArray, inviteCodesArray, and prefix
// prefix is specifically for command prefixes. It gets run through a special filter.
// channel and role are a single ID for their respective type and are stored as strings.
// channelArray is an array of channelIDs.
// inviteCodesArray is an array of known invite codes that have been given descriptors.
const { Collection } = require('discord.js');
const { writeConfigTables, getConfig } = require('../extras/common.js');

// commented vars either do nothing or are in development at this time.
const configurableProps = [{ varName:'prefix', description:'Command Prefix', varType:'prefix', default: '.' },
  { varName:'roleAdmin', description:'Admin Role', varType:'role', default: '' },
  { varName:'roleStaff', description:'Staff Role', varType:'role', default: '' },
  { varName:'roleUser', description:'Member Role', varType:'role', default: '' },
  /* { varName:'invLogToggle', description:'Toggle __Invite Iogging__', varType:'boolean', default: false },
  { varName:'channelInvLogs', description:'Channel for logging joins/leaves', varType:'channel', default: '' },
  { varName:'knownInvites', description:'Invite Code Descriptions', varType:'inviteCodesArray', default: [] },
  { varName:'avatarLogToggle', description:'Toggle __avatar change__ logging', varType:'boolean', default: false },
  { varName:'channelAvatarLogs', description:'Channel for logging avatar changes', varType:'channel', default: '' },
  { varName:'avatarLogAirlockOnlyToggle', description:'Toggle __airlock exclusive__ avatar logging/reporting', varType:'boolean', default: false }, */
  { varName:'countingToggle', description:'Toggle counting', varType:'boolean', default: false },
  { varName:'countingChannelId', description:'Counting channel', varType:'channel', default: '' },
  { varName:'voiceTextChannelIds', description:'Text channel(s) for voice-specific commands', varType:'channelArray', default: [] },
  { varName:'voiceChamberDefaultSizes', description:'Default limits for size-limited channels', varType:'voiceChamberSettings', default: '' },
  { varName:'voiceChamberSnapbackDelay', description:'Minutes before configured voice channels revert once empty', varType:'integer', default: '' },
  { varName:'pinsToPin', description:'Number of pin reacts to pin a message', varType:'integer', default: 0 },
  { varName:'pinMode', description:'Toggle pinning mode', varType:'boolean', default: false },
  { varName:'pinIgnoreChannels', description:'Channel(s) to ignore for pinning', varType:'channelArray', default: [] },
  { varName:'botChannelId', description:'Bot-specific message channel', varType:'channel', default: '' },
  { varName:'eventInfoChannelId', description:'Event announce channel', varType:'channel', default: '' },
  { varName:'starboardToggle', description:'Toggle starboard functionality', varType:'boolean', default: false },
  { varName:'starboardChannelId', description:'Starboard channel', varType:'channel', default: '' },
  { varName:'starThreshold', description:'Number of stars to starboard a message', varType:'integer', default: '' },
  { varName:'starboardIgnoreChannels', description:'Channel(s) to ignore for starboarding', varType:'channelArray', default: [] },
  { varName:'starboardPrivateChannels', description:'Channel(s) to consider private for starboarding purposes', varType:'channelArray', default: [] },
  { varName:'channelAnnouncements', description: 'Channel for making important announcements', varType:'channel', default: '' }];

async function prepTables(client, botdb) {
  client.guildConfig = new Collection();
  // first create tables if needed.
  await botdb.run(`CREATE TABLE IF NOT EXISTS config (
    guild_id TEXT NOT NULL,
    item TEXT NOT NULL,
    value ,
    PRIMARY KEY(guild_id, item)
  )`);
  await botdb.run(`CREATE TABLE IF NOT EXISTS config_index (
    item TEXT PRIMARY KEY,
    description TEXT NOT NULL UNIQUE,
    type TEXT
  )`);
  // Insert any new items from the configurableprops list into config index.
  let sqlStatement = 'INSERT OR IGNORE INTO config_index(item, description, type) VALUES';
  let propArr = [];
  for (const prop of configurableProps) {
    sqlStatement += '(?, ?, ?),';
    propArr.push(prop.varName, prop.description, prop.varType);
  }
  sqlStatement = sqlStatement.slice(0, -1) + ';';
  await botdb.run(sqlStatement, ...propArr);
  // then remove any items that have been removed from configurable props.
  const dbArr = await botdb.all('SELECT * FROM config_index');
  for (const d of dbArr) {
    const found = configurableProps.find(e => e.varName == d.item);
    if (!found) {
      await botdb.run('DELETE FROM config_index WHERE item = ?', d.item);
      await botdb.run('DELETE FROM config WHERE item = ?', d.item);
    }
  }
  // now populate the config table per-guild, adding any missing config items for a given guild.
  for (const guild of await client.guilds.fetch()) {
    // pull existing config items, if any, from db.
    let gConfigArr = await botdb.all('SELECT item, value FROM config WHERE guild_id = ?', guild[1].id);
    sqlStatement = 'INSERT OR IGNORE INTO config(guild_id, item, value) VALUES';
    propArr = [];
    for (const prop of configurableProps) {
      sqlStatement += '(?, ?, ?),';
      propArr.push(guild[1].id, prop.varName, prop.default);
    }
    sqlStatement = sqlStatement.slice(0, -1) + ';';
    await botdb.run(sqlStatement, ...propArr);
    // refresh what the SQL db shows... might be a better way of doing this but it's just a select and no joins
    gConfigArr = await botdb.all('SELECT item, value FROM config WHERE guild_id = ?', guild[1].id);
    const configObj = {};
    for (const d of gConfigArr) {
      // remove extraneous config entries.
      const found = configurableProps.find(e => e.varName == d.item);
      if (!found) {
        await botdb.run('DELETE FROM config WHERE item = ?', d.item);
      }
      // and assemble the config object for this guild iteravely.
      else {
        configObj[d.item] = d.value;
      }
    }
    // finally, add the guild to the client.guildConfig collection for later use, so we aren't doing going back to the db every time.
    await client.guildConfig.set(guild[1].id, configObj);
  }
}

module.exports = {
  name: 'config',
  description() {return 'Access configuration options for this bot.';},
  usage() {return '';},
  cooldown: 3,
  guildOnly: true,
  staffOnly: true,
  args: false,
  async execute(message, args, botdb) {
    const client = message.client;
    const config = getConfig(client, message.guild.id);
    // declaring some useful functions.

    // function to get a channel name from a chanID
    function getChannelName(channelId) {
      const channelObj = client.channels.cache.get(channelId);
      if (channelObj) {return channelObj.name;}
      else {return '[invalid or deleted channel]';}
    }
    // function to get a role name from a roleId
    function getRoleName(roleId) {
      const roleObj = message.guild.roles.cache.get(roleId);
      if (roleObj) {return roleObj.name;}
      else {return '[invalid or deleted role]';}
    }
    // function to get a channel object based on a channel ID or mention.
    async function getChannel(Id) {
      if (Id.startsWith('<#') && Id.endsWith('>')) {
        Id = Id.slice(2, -1);
        return await client.channels.cache.get(Id);
      }
      else {
        try { return await client.channels.cache.get(Id);}
        catch { return null;}
      }
    }

    async function getRole(Id) {
      if (Id.startsWith('<@&') && Id.endsWith('>')) {
        Id = Id.slice(3, -1);
        return await message.guild.roles.cache.get(Id);
      }
      else {
        try { return await message.guild.roles.cache.get(Id);}
        catch { return null;}
      }
    }

    // function to create a message collector.
    async function msgCollector() {
      // let responses = 0;
      let reply = false;
      // create a filter to ensure output is only accepted from the author who initiated the command.
      const filter = input => (input.author.id === message.author.id);
      await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
        // this method creates a collection; since there is only one entry we get the data from collected.first
        .then(collected => reply = collected.first())
        .catch(() => message.channel.send('Sorry, I waited 30 seconds with no response, please run the command again.'));
      // console.log('Reply processed...');
      return reply;
    }

    function outputConfig() {
      const ignoreChans = [];
      const voiceTextChans = [];
      const cfgVoiceChans = [];
      const starboardIgnoreChans = [];
      const starboardPrivateChans = [];
      const knownInv = [];
      if (config.pinIgnoreChannels.length > 0) {config.pinIgnoreChannels.forEach(chanId => ignoreChans.push(getChannelName(chanId)));}
      if (config.voiceTextChannelIds.length > 0) {config.voiceTextChannelIds.forEach(chanId => voiceTextChans.push(getChannelName(chanId)));}
      if (config.starboardIgnoreChannels.length > 0) {config.starboardIgnoreChannels.forEach(chanId => starboardIgnoreChans.push(getChannelName(chanId)));}
      if (config.starboardPrivateChannels.length > 0) {config.starboardPrivateChannels.forEach(chanId => starboardPrivateChans.push(getChannelName(chanId)));}
      if (config.knownInvites) {config.knownInvites.forEach(inv => knownInv.push('**' + inv[1] + '** (' + inv[0] + ')'));}
      //      console.log((Object.keys(config[voiceChamberDefaultSizes]).length == 0));
      // if(typeof config.voiceChamberDefaultSizes == 'object') Object.keys(config.voiceChamberDefaultSizes).forEach(chanId => cfgVoiceChans.push('#' + config.voiceChamberDefaultSizes[chanId].Name + ' (Size: ' + config.voiceChamberDefaultSizes[chanId].Size + ')'));

      return `Here's my current configuration:
__General settings__
Command prefix: **${config.prefix}**
Admin role: **${config.roleAdmin ? '@' + getRoleName(config.roleAdmin) : 'Not set'}**
Staff role: **${config.roleStaff ? '@' + getRoleName(config.roleStaff) : 'Not set'}**
Member role: **${config.roleComrade ? '@' + getRoleName(config.roleComrade) : 'Not set'}**
Airlock role: **${config.roleAirlock ? '@' + getRoleName(config.roleAirlock) : 'Not set'}**

__Special Channels:__
Counting: **${config.countingToggle ? ('#' + getChannelName(config.countingChannelId)) : 'Off.'}**
Bot channel: **${config.botChannelId ? ('#' + getChannelName(config.botChannelId)) : 'Not set.'}**
Event announcement channel: **${config.eventInfoChannelId ? ('#' + getChannelName(config.eventInfoChannelId)) : 'Not set.'}**
Airlock Channel Name/Prefix: **${config.airlockChannel ? config.airlockChannel : 'Not set'}**
Lobby channel: **${config.channelLobby ? ('#' + getChannelName(config.channelLobby)) : 'Not set.'}**
Prune Channel/Role Name: **${config.pruneTitle ? config.pruneTitle : 'Default (prune-limbo)'}**

__Logging/Notification Settings:__
User join/exit notifications: **${config.invLogToggle ? ('On!** In: **#' + getChannelName(config.channelInvLogs)) : 'Off.'}**
Log avatar changes: **${config.avatarLogToggle ? 'On!** In: ' + (config.channelAvatarLogs ? '**#' + getChannelName(config.channelAvatarLogs) + '**' : 'Not Set') + ' (for: ' + (config.avatarLogAirlockOnlyToggle ? '**airlock role only**)' : '**all members**)') : 'Off.**'}
Defined Invite Codes: ${(knownInv[0]) ? knownInv.join(', ') : '**None.**'}

__Voice Channel & Command Settings:__
Text channel(s) for voice commands: **${(config.voiceTextChannelIds[0]) ? '#' + voiceTextChans.join(', #') : 'None.'}**
Configured user-limited voice channels: **${(cfgVoiceChans[0]) ? cfgVoiceChans.join(', ') : 'None.'}**
Configured VC Snapback Delay: **${config.voiceChamberSnapbackDelay ? config.voiceChamberSnapbackDelay : 'Not set, defaulting to 5min.'}**

__Airlock/Lobby Settings:__
Airlock Prune Inactivity Limit: **${config.airlockPruneDays ? config.airlockPruneDays + 'day(s)' : 'Not set, defaulting to 7 days.'}**
Airlock Prune Message: **${config.airlockPruneMessage ? config.airlockPruneMessage : 'Not set.'}**

__Pins:__
Pin reacts needed to pin a message: **${config.pinsToPin}**
Channel(s) to ignore for pinning: **${(config.pinIgnoreChannels[0]) ? '#' + ignoreChans.join(', #') : 'None.'}**

__Starboard:__
Starboard: **${(config.starboardToggle) ? 'ON' : 'OFF'}**
Starboard Channel: ${config.starboardChannelId ? `**#${getChannelName(config.starboardChannelId)}**` : 'Not set. Starboard functionality disabled.'}
Star reaction threshold to post starboard: **${(config.starThreshold) ? config.starThreshold : (config.starboardChannelId) ? 'Not set. Starboard functionality disabled.' : 'N/A'}**
Channels to ignore for starboarding: **${(config.starboardIgnoreChannels[0]) ? '#' + starboardIgnoreChans.join(', #') : 'None.'}**
Channels considered private for starboarding (user must affirm they are OK with a post going to starboard): **${(config.starboardPrivateChannels[0]) ? '#' + starboardPrivateChans.join(', #') : 'None.'}**`;
    }
    // initialize disallowed prefix characters. None of these will be permitted in any part of the command prefix.
    const disallowedPrefix = ['@', '#', '/', '\\', '\\\\', '*', '~', '_'];

    if (args[0] && args[0].toLowerCase() == 'list' && args.length == 1) {
      return message.channel.send(outputConfig());
    }
    else if (args[0]) { return message.channel.send('I\'m sorry but I couldn\'t parse `' + args.join(' ') + '`');}
    // if command has no args, start the chat wizard to modify commands.
    else {
      message.channel.send(outputConfig() + '\n\n**Would you like to change any of these settings? (Y/N)**', { split: true });
      let reply = await msgCollector();
      if (!reply) { return; }
      if (reply.content.toLowerCase() == 'n' || reply.content.toLowerCase() == 'no') {
        return message.channel.send('OK!');
      }
      else if (reply.content.toLowerCase() != 'y' && reply.content.toLowerCase() != 'yes') {
        return message.channel.send(`Sorry, please answer Y or N. Type ${config.prefix}config to try again.`);
      }
      // new iterator
      let i = 0;
      const msgData = [];
      // parse through all configurable properties and place their description in a list.
      configurableProps.forEach(prop => {
        i++;
        msgData.push(`${i}. ${prop.description}`);
      });
      message.channel.send(`Which item would you like to change?\n${msgData.join('\n')}\nType 0 to cancel.`, { split: true });
      reply = await msgCollector();
      if (!reply) { return; }
      else if (reply.content == 0) { return message.channel.send('Canceling!');}
      else if (!parseInt(reply.content)) { return message.channel.send('Sorry, I couldn\'t parse that. Please answer with only the number of your response.'); }
      else if (configurableProps[parseInt(reply.content) - 1]) {
        const change = configurableProps[parseInt(reply.content) - 1];
        let replyContent = `Ok, so you want to change *${change.description}*.`;
        // handle response depending on the type of entry.
        if (change.varType == 'prefix') {
          replyContent += ' What would you like to change it to? (case sensitive)';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          if (reply.content.includes(' ')) { return message.channel.send('Sorry, I am unable to utilize prefixes that include a space.'); }
          else if (disallowedPrefix.some(noPrefix => reply.content.toLowerCase().includes(noPrefix.toLowerCase()))) { return message.channel.send('Sorry, the characters ' + disallowedPrefix.join('') + ' cannot be used in a prefix as each will conflict with some functionality of Discord.'); }
          else {
            config[change.varName] = reply.content;
            writeConfigTables(botdb, message.client, message.guild.id);
            return message.channel.send(`Setting ${change.description} to '**${reply.content}**'.`);
          }
        }
        else if (change.varType == 'boolean') {
          replyContent += ' Would you like to turn it on or off?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if (!reply) {return;}
          switch (reply.content.toLowerCase()) {
          case 'on':
          case 'true':
            config[change.varName] = true;
            writeConfigTables(botdb, message.client, message.guild.id);
            return message.channel.send(`${change.description} is now '**ON**'.`);
          case 'off':
          case 'false':
            config[change.varName] = false;
            writeConfigTables(botdb, message.client, message.guild.id);
            return message.channel.send(`${change.description} is now '**OFF**'.`);
          default:
            return message.channel.send(`I'm sorry, I couldn't parse "${reply.content}". Please use 'on' or 'off' to set this setting.`);
          }
        }
        else if (change.varType == 'channel') {
          replyContent += ' Please #mention the channel you would like it changed to, or copy/paste the channel ID.';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          const newChannel = await getChannel(reply.content);
          // const oldChannelId = config[change.varName] || null;
          if (newChannel) {
            config[change.varName] = newChannel.id;
            writeConfigTables(botdb, message.client, message.guild.id);
            /* TODO counting not implemented
             if (change.varName == 'countingChannelId') {
              global.countingData.lastCount = 0;
              global.countingData.lastMessage = message.id;
              writeCounting();
              return message.channel.send(`${change.description} is now ${newChannel}. Count has been reset to 0.`);
            } */
            /* TODO events not implemented
             if (change.varName == 'eventInfoChannelId') {
              await event.regenMsgs(oldChannelId, newChannel.id, message.guild);
              return message.channel.send(`${change.description} is now ${newChannel}. Deleting info messages from old channel (if applicable) and recreating.`);
            } */
            if (change.varName == 'starboardChannelId') {
              return message.channel.send(`${change.description} is now ${newChannel}. Defaulting starboard threshold to 5 stars. This can be changed with the config command.`);
            }
            return message.channel.send(`${change.description} is now ${newChannel}.`);
          }
          else {return message.channel.send(`Sorry, I couldn't parse '${reply.content}' into a channel. Please #mention the channel or copy/paste the channel ID.`);}
        }
        else if (change.varType == 'role') {
          replyContent += ' Please @mention the role you would like it changed to, or copy/paste the role ID.';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          const newRole = await getRole(reply.content);
          if (newRole) {
            config[change.varName] = newRole.id;
            writeConfigTables(botdb, message.client, message.guild.id);
            return message.channel.send(`${change.description} is now **${newRole.name}**.`);
          }
          else {return message.channel.send(`Sorry, I couldn't parse '${reply.content}' into a role. Please @mention the role or copy/paste the role ID.`);}
        }
        else if (change.varType == 'integer') {
          replyContent += ' What would you like to change it to?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          if (!reply.content.includes('.') && parseInt(reply.content)) {
            config[change.varName] = parseInt(reply.content);
            writeConfigTables(botdb, message.client, message.guild.id);
            return message.channel.send(`${change.description} is now **${parseInt(reply.content)}**.`);
          }
          else {return message.channel.send(`Sorry, I couldn't parse '${reply.content}' into a count. Please enter an integer (no decimals).`);}
        }
        else if (change.varType == 'string') {
          replyContent += ' What would you like to change it to?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          config[change.varName] = reply.content.replace(/"/g, '');
          writeConfigTables(botdb, message.client, message.guild.id);
          return message.channel.send(`${change.description} is now **${reply.content.replace(/"/g, '')}**.`);
        }
        else if (change.varType == 'voiceChamberSettings') {
          replyContent += ' Would you like to **add**, **remove**, or **change** a channel from the list?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          if (reply.content.toLowerCase() == 'add') {
            message.channel.send('Please paste the channel ID.');
            reply = await msgCollector();
            if(!reply) {return;}
            const newChannel = await getChannel(reply.content);
            if (!config[change.varName]) {
              config[change.varName] = new Object();
            }
            if (!config[change.varName][newChannel.id]) {
              config[change.varName][newChannel.id] = new Object();
              message.channel.send('Please enter the default name for the channel (this should really be 24 chars or less). You can say "current" to use the name it already has');
              reply = await msgCollector();
              if(!reply) {return;}
              if(reply.content.toLowerCase() == 'current') {
                config[change.varName][newChannel.id]['Name'] = newChannel.name.replace(/"/g, '');
              }
              else {
                config[change.varName][newChannel.id]['Name'] = reply.content.replace(/"/g, '');
              }
              message.channel.send('Please send the default user limit for this channel (e.g. "4")');
              reply = await msgCollector();
              if(!reply) {return;}
              if (!reply.content.includes('.') && parseInt(reply.content) && reply.content <= 99) {
                config[change.varName][newChannel.id]['Size'] = reply.content;
                writeConfigTables(botdb, message.client, message.guild.id);
                return message.channel.send(`Added ${newChannel} to the list of voice chambers with a default size of **${parseInt(reply.content)}**`);
              }
              else {return message.channel.send(`Sorry, I couldn't parse '${reply.content}' into a count or the entry was over 99 (discord's max). Please enter an integer (no decimals) 99 or under.`);}
            }
            else {return message.channel.send(`${newChannel} is already in the list of voice chambers`);}
          }

          else if (reply.content.toLowerCase() == 'remove') {
            if(!config.voiceChamberDefaultSizes) { return message.channel.send('No channels have been setup, you should do that first'); }
            else if(Object.keys(config[change.varName]).length == 0) { return message.channel.send('No channels have been setup, you should do that first'); }

            const chanArr = [];
            const msgArr = [];
            i = 0;
            for (const chanId in config[change.varName]) {
              i++;
              const chan = await getChannel(chanId);
              if (chan) {
                chanArr.push(chan);
                msgArr.push(`${i}. ${config[change.varName][chanId]['Name']}`);
              }
              else {
                msgArr.push(`Bad channel ID in config.json! See console for details; type ${i} to just delete this entry.`);
                console.log(`Could not find channel ID ${chanId} in ${change.varName}!`);
              }
            }
            message.channel.send(`Please choose from the following to remove:\n${msgArr.join('\n')}\ntype all to remove all items.\ntype 0 to cancel.`);
            reply = await msgCollector();
            if (!reply) { return; }
            else if (reply.content.toLowerCase() == 'all') {
              config[change.varName] = {};
              writeConfigTables(botdb, message.client, message.guild.id);
              return message.channel.send(`Cleared all *${change.description}* entries.`);
            }
            else if (parseInt(reply.content) > Object.keys(config[change.varName]).length) {
              return message.channel.send('Invalid entry! That\'s more than the highest item on the list!');
            }
            else if (reply.content == 0) {
              return message.channel.send('Canceled. No values changed.');
            }
            else if (reply.content.includes('.') || !parseInt(reply.content)) {
              return message.channel.send('Sorry, I couldn\'t parse that. Please answer with only the number of your response.');
            }
            else {
              const indexToRemove = parseInt(reply.content) - 1;
              const removedChan = await getChannel(Object.keys(config[change.varName])[indexToRemove]);
              delete config[change.varName][Object.keys(config[change.varName])[indexToRemove]];
              writeConfigTables(botdb, message.client, message.guild.id);
              if (removedChan) { return message.channel.send(`Removed ${removedChan} from *${change.description}*.`); }
              else { return message.channel.send(`Removed bad entry ${config[change.varName][indexToRemove]} from *${change.description}*`); }
            }
          }

          else if (reply.content.toLowerCase() == 'change') {
            if(!config.voiceChamberDefaultSizes) { return message.channel.send('No channels have been setup, you should do that first'); }
            else if(Object.keys(config[change.varName]).length == 0) { return message.channel.send('No channels have been setup, you should do that first'); }

            const chanArr = [];
            const msgArr = [];
            i = 0;
            for (const chanId in config[change.varName]) {
              i++;
              const chan = await getChannel(chanId);
              if (chan) {
                chanArr.push(chan);
                msgArr.push(`${i}. ${config[change.varName][chanId]['Name']} (default size: ${config[change.varName][chanId]['Size']})`);
              }
              else {
                msgArr.push(`Bad channel ID in config.json! See console for details; type ${i} to just delete this entry.`);
                console.log(`Could not find channel ID ${chanId} in ${change.varName}!`);
              }
            }
            message.channel.send(`Please choose from the following to change:\n${msgArr.join('\n')}\ntype 0 to cancel.`);
            reply = await msgCollector();
            if (!reply) { return; }
            else if (parseInt(reply.content) > Object.keys(config[change.varName]).length) {
              return message.channel.send('Invalid entry! That\'s more than the highest item on the list!');
            }
            else if (reply.content == 0) {
              return message.channel.send('Canceled. No values changed.');
            }
            else if (reply.content.includes('.') || !parseInt(reply.content)) {
              return message.channel.send('Sorry, I couldn\'t parse that. Please answer with only the number of your response.');
            }
            else {
              const indexToChange = parseInt(reply.content) - 1;
              const chanId = Object.keys(config[change.varName])[indexToChange];

              message.channel.send('Do you want to change the default **name**, **size**, or **both**?');
              reply = await msgCollector();
              if (!reply) { return; }

              const type = reply.content.toLowerCase();

              if (type == 'name' || type == 'both') {
                message.channel.send('Please enter the default name for the channel (this should really be 24 chars or less)');
                reply = await msgCollector();
                if(!reply) {return;}
                config[change.varName][chanId]['Name'] = reply.content.replace(/"/g, '');
              }

              if (type == 'size' || type == 'both') {
                message.channel.send('Please send the default user limit for this channel (e.g. "4")');
                reply = await msgCollector();
                if(!reply) {return;}
                if (!reply.content.includes('.') && parseInt(reply.content) && reply.content <= 99) {
                  config[change.varName][chanId]['Size'] = reply.content;
                }
                else {
                  return message.channel.send('Sorry, I couldn\'t parse that, or the entry was over 99 (discord\'s max). Please enter an integer (no decimals) 99 or under.');
                }
              }

              writeConfigTables(botdb, message.client, message.guild.id);
              return message.channel.send(`Updated ${config[change.varName][chanId]['Name']}'s defaults. The default size is **${config[change.varName][chanId]['Size']}**`);
            }
          }
        }
        else if (change.varType == 'inviteCodesArray') {
          if (!config[change.varName]) {config[change.varName] = [];}
          replyContent += ' Would you like to **add**, **remove**, or **change** an invite code description from the list?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          if (reply.content.toLowerCase() == 'add') {
            message.channel.send('Please say the invite code you would like to add to the list.');
            reply = await msgCollector();
            if(!reply) {return;}
            const response = reply.content.split('/').pop();
            const knownInvites = new Map(config.knownInvites);
            if (!knownInvites.has(response)) {
              message.guild.invites.fetch().then(async guildInvites => {
                let invite = new Collection;
                if (guildInvites.has(response)) {
                  invite = guildInvites.get(response);
                  const inviter = client.users.cache.get(invite.inviter.id);
                  message.channel.send('Okay, what do you want the description to be?');
                  reply = await msgCollector();
                  if(!reply) {return;}
                  config[change.varName].push([invite.code, reply.content.replace(/"/g, '')]);
                  writeConfigTables(botdb, message.client, message.guild.id);
                  return message.channel.send(`Ok! **${reply.content.replace(/"/g, '')}** (${invite.code}) by <@${inviter.id}> (${inviter.username}#${inviter.discriminator} / ${inviter.id}) has been added to the *${change.description}*`);
                }
                else {
                  return message.channel.send('The invite code you provided wasn\'t found on the server. Please make sure you pasted it in correctly!');
                }
              });
            }
            else {
              return message.channel.send(`**${knownInvites.get(response)}** (${response}) is already in *${change.description}*`);
            }
          }
          if ((reply.content.toLowerCase() == 'remove' || reply.content.toLowerCase() == 'change')) {
            if (config[change.varName].length == 0) { return message.channel.send('No invite code descriptions have been setup, you should do that first'); }
            const action = reply.content.toLowerCase();
            const invCodeArr = [];
            const msgArr = [];
            i = 0;
            for (const invcode of config[change.varName]) {
              i++;
              invCodeArr.push(invcode);
              msgArr.push(`${i}. **${invcode[1]}** (${invcode[0]})`);
            }
            if (action == 'remove') msgArr.push('\ntype all to remove all items.');
            message.channel.send(`Please choose from the following to ${action}:\n${msgArr.join('\n')}\ntype 0 to cancel.`);
            reply = await msgCollector();
            if (!reply) { return; }
            else if (reply.content.toLowerCase() == 'all' && action == 'remove') {
              config[change.varName] = [];
              writeConfigTables(botdb, message.client, message.guild.id);
              return message.channel.send(`Cleared all *${change.description}* entries.`);
            }
            else if (parseInt(reply.content) > config[change.varName].length) {
              return message.channel.send('Invalid entry! That\'s more than the highest item on the list!');
            }
            else if (reply.content == 0) {
              return message.channel.send('Canceled. No values changed.');
            }
            else if (reply.content.includes('.') || !parseInt(reply.content)) {
              return message.channel.send('Sorry, I couldn\'t parse that. Please answer with only the number of your response.');
            }

            else {
              const index = parseInt(reply.content) - 1;
              const selectedInv = config[change.varName][index];
              if (action == 'remove') {
                config[change.varName].splice(index, 1);
                writeConfigTables(botdb, message.client, message.guild.id);
                return message.channel.send(`Removed ${selectedInv[1]} (${selectedInv[0]}) from *${change.description}*.`);
              }
              else if (action == 'change') {
                message.channel.send('What should be the new description for this invite code?');
                reply = await msgCollector();
                if(!reply) {return;}
                config[change.varName][index][1] = reply.content.replace(/"/g, '');
                writeConfigTables(botdb, message.client, message.guild.id);
                return message.channel.send(`Changed the description for ${selectedInv[0]} from ${selectedInv[1]} to ${config[change.varName][index][1]} in the *${change.description}*.`);
              }
            }
          }
        }

        else if (change.varType == 'channelArray') {
          replyContent += ' Would you like to add or remove a channel from the list?';
          message.channel.send(replyContent);
          reply = await msgCollector();
          if(!reply) {return;}
          if (reply.content.toLowerCase() == 'add') {
            message.channel.send('Please #mention or type the channelid of the channel you would like to add to the list, or copy/paste the channel ID. You may also #mention or type the ID of a category for all channels under that category to be added.');
            reply = await msgCollector();
            if(!reply) {return;}
            const newChannel = await getChannel(reply.content);
            if (newChannel.type == 'GUILD_TEXT') {
              if (!config[change.varName].includes(newChannel.id)) {
                config[change.varName].push(newChannel.id);
                writeConfigTables(botdb, message.client, message.guild.id);
                return message.channel.send(`Added ${newChannel} to *${change.description}*`);
              }
              else {return message.channel.send(`${newChannel} is already a part of *${change.description}*`);}
            }
            else if(newChannel.type == 'GUILD_CATEGORY') {
              const alreadyInListArr = [];
              const addedArr = [];
              for (const childChannel of newChannel.children.values()) {
                if (!config[change.varName].includes(childChannel.id)) {
                  config[change.varName].push(childChannel.id);
                  addedArr.push(childChannel);
                }
                else { alreadyInListArr.push(childChannel); }
              }
              writeConfigTables(botdb, message.client, message.guild.id);
              return message.channel.send(`${addedArr.length > 0 ? `Added channels ${addedArr.join(' ')} to ${change.description}` : ''} ${alreadyInListArr.length > 0 ? `${alreadyInListArr.join(' ')} was/were already part of ${change.description}` : ' '}`);
            }
          }
          else if (reply.content.toLowerCase() == 'remove' && config[change.varName].length > 0) {
            const chanArr = [];
            const msgArr = [];
            i = 0;
            for (const chanId of config[change.varName]) {
              i++;
              const chan = await getChannel(chanId);
              if (chan) {
                chanArr.push(chan);
                msgArr.push(`${i}. ${chan}`);
              }
              else {
                msgArr.push(`Bad channel ID in config.json! See console for details; type ${i} to just delete this entry.`);
                console.log(`Could not find channel ID ${chanId} in ${change.varName}!`);
              }
            }
            await message.channel.send(`Please choose from the following to remove:\n${msgArr.join('\n')}\ntype all to remove all items.\ntype 0 to cancel.`, { split: true });
            reply = await msgCollector();
            if (!reply) { return; }
            else if (reply.content.toLowerCase() == 'all') {
              config[change.varName] = [];
              writeConfigTables(botdb, message.client, message.guild.id);
              return message.channel.send(`Cleared all *${change.description}* entries.`);
            }
            else if (parseInt(reply.content) > config[change.varName].length) {
              return message.channel.send('Invalid entry! That\'s more than the highest item on the list!');
            }
            else if (reply.content == 0) {
              return message.channel.send('Canceled. No values changed.');
            }
            else if (reply.content.includes('.') || !parseInt(reply.content)) {
              return message.channel.send('Sorry, I couldn\'t parse that. Please answer with only the number of your response.');
            }
            else {
              const indexToRemove = parseInt(reply.content) - 1;
              const removedChan = await getChannel(config[change.varName][indexToRemove]);
              config[change.varName].splice(indexToRemove, 1);
              writeConfigTables(botdb, message.client, message.guild.id);
              if (removedChan) { return message.channel.send(`Removed ${removedChan} from *${change.description}*.`); }
              else { return message.channel.send(`Removed bad entry ${config[change.varName][indexToRemove]} from *${change.description}*`); }
            }
          }
        }
      }
    }
    // else { message.channel.send('hmm, check your input'); }
    // const config = getConfig(message.client, message.guild.id);
    writeConfigTables(botdb, message.client, message.guild.id);
  },
  prepTables: prepTables,
};