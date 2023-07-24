// refactored for "brobot" by mindset
// based on rewrites by anotak to
// Sciman101's JNFR emojirole.js from here:
// https://github.com/Sciman101/JNFR/blob/master/commands/emojirole.js
// TODO: add function to move a post to a new channel.
const { MessageEmbed } = require('discord.js');
const discordEmojiTest = new RegExp(/<a?:.+?:(\d+)>$/);
const { getConfig, validateEmoji } = require('../extras/common.js');

async function prepTables(botdb) {
  // debug stuff
  // await botdb.run('DROP TABLE IF EXISTS role_menu_messages');
  // await botdb.run('DROP TABLE IF EXISTS role_menu_emoji');
  // generate tables if needed.
  await botdb.run('CREATE TABLE IF NOT EXISTS role_menu_messages (message_id text NOT NULL UNIQUE, guild_id text NOT NULL, channel_id text NOT NULL, label text NOT NULL, header text, footer text, active integer, PRIMARY KEY(message_id) UNIQUE(guild_id, label)) ');
  await botdb.run('CREATE TABLE IF NOT EXISTS role_menu_emoji (message_id text NOT NULL, role_id text NOT NULL, emoji text, name text, UNIQUE(message_id, role_id), UNIQUE(message_id, emoji))');
  // delete orphaned role_emoji
  await botdb.run('DELETE FROM role_menu_emoji WHERE (message_id, emoji) IN (SELECT role_menu_emoji.message_id, emoji FROM role_menu_emoji LEFT JOIN role_menu_messages ON role_menu_emoji.message_id = role_menu_messages.message_id WHERE role_menu_messages.message_id IS NULL)');
}

module.exports = {
  name: 'emojirole',
  cooldown: 1,
  description() {return 'Setup reaction-based roles for your server.';},
  args:true,
  usage(config) {
    return `<newpost add|remove|header|footer|activate|deactivate|deletepost|list> <label> <options (see below)>.
**Important: post labels may not contain spaces!**
*${config.prefix}${module.exports.name} newpost <post label> <channel mention or ID>* - create a new emoji post with the given parameters, but don't post it yet. It can be posted with the activate subcommand.
*${config.prefix}${module.exports.name} <add|remove> <post label> <emoji> <@role mention or ID(not required for remove)>* - add or remove a role from a role post. Can be done if active or inactive.
*${config.prefix}${module.exports.name} <header|footer> <text>* - add a header or footer to a role post.
*${config.prefix}${module.exports.name} <activate|deactivate> <post label>* - activate a role post by posting it to its assigned channel.
*${config.prefix}${module.exports.name} deletepost <post label>* - delete a role post from memory.  Can only be used on deactivated posts.
*${config.prefix}${module.exports.name} list <up to 5 post labels separated by a space (optional)>* - If used without labels, lists all role posts for this server. If used with label(s), lists the role options for the listed posts`;
  },
  guildOnly:true,
  staffOnly:true,
  async execute(message, args, botdb) {

    const action = args.shift();

    if(!action) {
      return message.reply('Missing action (add, remove, newpost, header, footer)');
    }

    const guild = message.guild;
    if (!guild.available) {
      return;
    }
    switch(action.toLowerCase()) {
    case 'add':
      return await addRoleToPost(message, args, botdb);
    case 'remove':
      return await removeRoleFromPost(message, args, botdb);
    case 'newpost':
      return await newRolePost(message, args, botdb);
    case 'header':
      return await setRolePostAttrib(message, args, botdb, 'header');
    case 'footer':
      return await setRolePostAttrib(message, args, botdb, 'footer');
    case 'activate':
      return await activateRolePost(message, args, botdb);
    case 'deactivate':
      return await deactivateRolePost(message, args, botdb);
    case 'delete':
      return await deleteRolePost(message, args, botdb);
    case 'list':
      return await listRolePosts(message, args, botdb);
    default:
      return message.reply('Unknown action ' + action);
    }
  },
  async init(client, botdb) {
    await prepTables(botdb);
    // Now the important part: The listener
    client.on('messageReactionAdd', async (reaction, user) => {
      // return if reaction was done by a bot, or if the message is not in the rolemenu db
      if (user.bot) { return; }
      if (!(await botdb.get('SELECT * FROM role_menu_messages WHERE message_id = ?', reaction.message.id))) { return; }
      // When a reaction is received, check if the structure is partial
      if (reaction.partial) {
        try {
          await reaction.fetch();
        }
        catch (error) {
          console.error('Something went wrong when fetching the message: ', error);
          return;
        }
      }
      const message = reaction.message;
      let emojiResolvable = reaction.emoji.name;
      if (reaction.emoji.id) {
        emojiResolvable = `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }
      const emojiData = await getPostEmoji(message.id, emojiResolvable, botdb);
      // Did it exist?
      if (emojiData) {
        // Give the role to the user!
        const role = await message.guild.roles.fetch(emojiData.role_id);
        const member = await message.guild.members.fetch(user.id.toString());
        if (role && member && !member.roles.cache.has(role.id)) {
          await member.roles.add(role);
          try {
            await member.send({ content: `Gave you the ${role.name} role!` });
          }
          catch {
            console.info(`Could not send role DM to user ${member.user.tag}. They probably have DMs disabled; this is noncritical.`);
          }
        }
      }
      else {
        reaction.remove();
      }
    });
    client.on('messageReactionRemove', async (reaction, user) => {
      // return if reaction was done by a bot, or if the message is not in the rolemenu db
      if (user.bot) return;
      if (!(await botdb.get('SELECT * FROM role_menu_messages WHERE message_id = ?', reaction.message.id))) { return; }
      // When a reaction is received, check if the structure is partial
      if (reaction.partial) {
        // If the message this reaction belongs to was removed, the fetching might result in an API error which should be handled
        try {
          await reaction.fetch();
        }
        catch (error) {
          console.error('Something went wrong when fetching the message: ', error);
          // Return as `reaction.message.author` may be undefined/null
          return;
        }
      }
      const message = reaction.message;
      let emojiResolvable = reaction.emoji.name;
      if (reaction.emoji.id) {
        emojiResolvable = `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }
      const emojiData = await getPostEmoji(message.id, emojiResolvable, botdb);
      // Did it exist?
      if (emojiData) {
        // Remove the role from the user!
        const role = await message.guild.roles.fetch(emojiData.role_id);
        const member = await message.guild.members.fetch(user.id.toString());
        if (role && member && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
          try {
            await member.send({ content: `Removed the ${role.name} role!` });
          }
          catch {
            console.info(`Could not send role DM to user ${member.user.tag}. They probably have DMs disabled; this is noncritical.`);
          }
        }
      }
    });
  },
};

/**
* Parse and convert a roleID/mention to a useable role object.
*
* @param potentialRole role mention or raw roleID
* @param message Discord message object
*
* @returns Discord role object, or a reply to original message with an error.
*/
async function parseRole(potentialRole, message) {
  if(!potentialRole) {
    message.reply('You need to specify a role');
    return false;
  }
  // convert potentialRole to raw roleID if needed.
  let roleFetchable = '';
  if ((potentialRole.startsWith('<@&') && potentialRole.endsWith('>'))) { roleFetchable = potentialRole.slice(3, -1); }
  else { roleFetchable = potentialRole; }

  // get role and handle errors
  try {
    const role = await message.guild.roles.fetch(roleFetchable);
    if (role == message.guild.roles.everyone) { return message.reply('You can\'t make an emoji role for @ everyone.'); }
    else if (!role) { return message.reply(`I couldn't parse ${potentialRole}, or it is not a role on this server.`);}
    return role;
  }
  catch(err) {
    console.error(err.message);
    message.reply(`'${potentialRole}' does not appear to be a valid role. Please check your input.`);
    return null;
  }
}

/**
* Parse and return a channel.
*
* @param potentialRole channel mention or raw channelID
* @param message Discord message object
*
* @returns Discord channel object, or a reply to original message with an error.
*/
async function parseChannel(potentialChannel, message) {
  if(!potentialChannel) {
    return message.reply('not enough arguments, expected a channel');
  }
  // convert potentialChannel to raw channelID if needed.
  let channelFetchable = '';
  if ((potentialChannel.startsWith('<#') && potentialChannel.endsWith('>'))) { channelFetchable = potentialChannel.slice(2, -1); }
  else { channelFetchable = potentialChannel; }
  try {
    const channel = await message.guild.channels.fetch(channelFetchable);
    if (channel.type != 'GUILD_TEXT') {
      return message.reply(potentialChannel + ' is not a text channel. You need to specify a text channel');
    }
    return channel;
  }
  catch(err) {
    if (err.message == 'Unknown Channel' || err.message.endsWith() == 'is not snowflake.') {
      return message.reply(`'${potentialChannel}' is not a valid channel. Please check your input.`);
    }
    else {
      console.error(err);
      return message.reply('There was an error retrieving channel data! Please check the console for details.');
    }
  }
}

/**
* Retrieve data from DB on a role menu post using its label
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns Discord channel object, or a reply to original message with an error.
*/
async function getPostbyLabel(message, label, botdb) {
  const stored = await botdb.get('SELECT * FROM role_menu_messages WHERE guild_id = ? AND label = ?', message.guild.id, label);
  if (stored) {
    return stored;
  }
  return null;
}


/**
* Search db for emoji with a post id.
* @param messageId message id of post
* @param emoji emoji to search for in db; if null this returns an array of all emoji items on the post.
* @param botdb bot database
*
* @returns emoji object {message_id, role_id, emoji} or array of all emoji objects on message.
*/
async function getPostEmoji(messageId, emoji, botdb) {
  if (emoji) { return await botdb.get('SELECT * FROM role_menu_emoji WHERE message_id = ? AND emoji = ?', messageId, emoji);}
  else { return await botdb.all('SELECT * FROM role_menu_emoji WHERE message_id = ?', messageId); }
}

/**
* If a post exists and is set to active, attempts to edit the post and update it.
* @param message message object of command
* @param post post object generated by getPostbyLabel()
* @param botdb bot database
* @param exMsg [optional] message object of existing post, if already found earlier.
*
* @returns edits the post message to add a new role to the list. Roles are displayed in order they are added.
*/
async function updatePost(message, post, botdb, exMsg = false) {
  const postChannel = await message.guild.channels.fetch(post.channel_id);
  const embedData = await generateEmbed(post, botdb);
  let postMsg = exMsg;
  if (!postMsg) {
    try {
      postMsg = await postChannel.messages.fetch(post.message_id);
    }
    catch (err) {
      if (err.message == 'Unknown Message') {
        message.reply(`My records indicate that post with label ${post.label} is active, but I couldn't find the post! Use the activate subcommand to repost it.`);
        await botdb.run('UPDATE role_menu_messages SET active = 0 WHERE label = ? AND guild_id = ?', post.label, post.guild_id);
        return;
      }
      else{
        console.err(err);
        message.reply('Error updating role post! see log for details.');
        return;
      }
    }
  }
  try {
    await postMsg.edit({ embeds: [embedData] });
    await getPostEmoji(postMsg.id, null, botdb).then(async arr => {
      const emojiIdArr = [];
      arr.forEach(async e => {
        await postMsg.react(e.emoji);
        emojiIdArr.push(discordEmojiTest.exec(e.emoji)[1]);
      });
      // remove any extraneous reactions
      postMsg.reactions.cache.forEach(async (value, key) => {
        if(!emojiIdArr.includes(key)) {
          await postMsg.reactions.resolveId(key).then(r => r.remove());
        }
      });
    });
  }
  catch (err) {
    console.err(err);
    message.reply('Error updating role post! see log for details.');
    return;
  }
}

/**
* If a post exists and is set to active, attempts to edit the post and update it.
* TODO: If this can't be done, reposts the message and updates message ids in db.
* @param message message object of command
* @param post post object generated by getPostbyLabel()
* @param botdb bot database
*
* @returns edits the post message to add a new role to the list. Roles are displayed in order they are added.
*/
async function makeRolePost(message, post, botdb) {
  const postChannel = await message.guild.channels.fetch(post.channel_id);
  const embedData = await generateEmbed(post, botdb);
  try {
    const newMsg = await postChannel.send({ embeds: [embedData] });
    // update AFTER running getPostEmoji to avoid causing problems when posting the reacts
    await botdb.run('UPDATE role_menu_messages SET message_id = ?, active = 1 WHERE label = ? AND guild_id = ?', newMsg.id, post.label, post.guild_id);
    await botdb.run('UPDATE role_menu_emoji SET message_id = ? WHERE message_id = ?', newMsg.id, post.message_id);
    await getPostEmoji(newMsg.id, null, botdb).then(async arr => {
      // console.log(arr);
      await arr.forEach(async e => {
        await newMsg.react(e.emoji);
      });
    });
  }
  catch (err) {
    console.error(err);
    message.reply('error!');
  }
}

async function generateEmbed(post, botdb) {
  const newEmbed = new MessageEmbed()
    .setTitle(post.header || post.label)
    .setFooter({ text: ((post.footer || '') + ' Label:' + post.label) });
  let fieldContents = '';
  await getPostEmoji(post.message_id, null, botdb).then(arr => {
    arr.forEach(e => {
      fieldContents += `${e.emoji} - ${e.name}\n`;
    });
  });
  newEmbed.addField('React to give yourself a role.', fieldContents);
  return newEmbed;
}

/**
* Prep a new role post in the database with a specified label.
* Will not actively post the item - use the "activate" subcommand to do so.
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns message to channel stating success/failure.
*/
async function newRolePost(message, args, botdb) {

  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const channel = await parseChannel(args.shift(), message);
  if(!channel || channel.type != 'GUILD_TEXT') {
    return;
  }
  if(args.length > 0) {
    return message.reply('Too many parameters! \'' + args[0] + '\' and everything past it is not useable.');
  }

  const existPost = await getPostbyLabel(message, label, botdb);
  if(existPost && existPost.active) {
    return message.reply(`A post with label ${existPost.label} already exists in <#${channel.id}>`);
  }
  else if(existPost && !existPost.active) {
    return message.reply(`A post with label ${existPost.label} already exists in <#${channel.id}>, but is not yet active. Use the activate function to post it!`);
  }
  const newPost = {
    // use a semirandom "snowflake" as a placeholder value for message_id, since it can't be null.
    // when the item is posted, update this to be the same as the message id of the post.
    message_id: (Date.now().toString(10) + (Math.random() * 999).toFixed(0).toString(10).padStart(3, '0')),
    guild_id: channel.guild.id,
    channel_id: channel.id,
    label:label,
  };
  await botdb.run('INSERT INTO role_menu_messages(message_id,guild_id,channel_id,label,active) VALUES(?,?,?,?,?)', newPost.message_id, newPost.guild_id, newPost.channel_id, newPost.label, 0);
  return message.reply(`post with label ${newPost.label} added for channel ${channel}`);
}

/**
* Add a role to a post by its label, then update the post if it's active.
* Will not actively post the item - use the "activate" subcommand to do so.
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns message to channel stating success/failure.
*/
async function addRoleToPost(message, args, botdb) {
  // first arg should be the label for the post.
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);

  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }

  const emoji = args.shift();
  const cleanEmoji = await validateEmoji(message.client, emoji);
  if(!cleanEmoji) {
    return message.reply(`'${emoji}' is either not a single unicode emoji, or not an emoji from any server that this bot is present in.`);
  }

  // get role data
  const role = await parseRole(args.shift(), message);
  if(!role || !role.id) {
    return;
  }

  const overflow = args.shift();
  if(overflow) {
    return message.reply(`Too many parameters - '${args.join(' ')}' is not required for this command.`);
  }

  // search db for matching emoji + post id
  const emojiData = await getPostEmoji(post.message_id, emoji, botdb);
  if (emojiData) { return message.reply(`The post with label '${post.label}' already has a role that uses ${emoji}!`);}

  // store bot data and update post if it's active.
  await botdb.run('INSERT INTO role_menu_emoji(message_id,role_id,emoji,name) VALUES(?,?,?,?)', post.message_id, role.id, emoji, role.name);
  message.reply(`Added ${emoji} to role post labeled ${post.label}!`);
  if(post.active) { await updatePost(message, post, botdb); }

}

/**
* Remove a role from a post by its label, then update the post if it's active.
* Will not actively post the item - use the "activate" subcommand to do so.
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns message to channel stating success/failure.
*/
async function removeRoleFromPost(message, args, botdb) {
  // first arg should be the label for the post.
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);

  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }

  const emoji = args.shift();
  const cleanEmoji = await validateEmoji(message.client, emoji);
  if(!cleanEmoji) {
    return message.reply(`'${emoji}' is either not a single unicode emoji, or not an emoji from any server that this bot is present in.`);
  }

  const overflow = args.shift();
  if(overflow) {
    return message.reply(`Too many parameters - '${overflow + ' ' + args.join(' ')}' is not required for this command.`);
  }
  // search db for matching emoji + post id
  const emojiData = await getPostEmoji(post.message_id, emoji, botdb);
  if (!emojiData) { return message.reply(`The post with label '${post.label}' does not have a role that uses ${emoji}!`);}
  else {
    await botdb.run('DELETE FROM role_menu_emoji WHERE message_id = ? AND emoji = ?', post.message_id, emoji);
  }
  if(post.active) { await updatePost(message, post, botdb); }
  return message.reply(`Removed ${emoji} from role post labeled ${post.label}!`);
}

/**
* Update attributes of role embed (header/footer)
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
* @param key 'header' or 'footer'

* @returns message to channel stating success/failure.
*/
async function setRolePostAttrib(message, args, botdb, key) {
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);
  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }
  post[key] = args.join(' ');
  let exMsg = false;
  if (post.active) {
    try {
      exMsg = await message.guild.channels.fetch(post.channel_id).then(async c => await c.messages.fetch(post.message_id));
    }
    catch (err) {
      console.error(err);
    }
  }

  switch(key) {
  case 'header':
    await botdb.run('UPDATE role_menu_messages SET header = ? WHERE message_id = ?', post.header, post.message_id);
    break;
  case 'footer':
    await botdb.run('UPDATE role_menu_messages SET footer = ? WHERE message_id = ?', post.footer, post.message_id);
    break;
  default:
    break;
  }
  if(post.active) { return await updatePost(message, post, botdb, exMsg); }
  else { return message.reply(`Set ${key} to ${post[key]} for post labeled ${post.label}`); }
}

/**
* Activate a role post
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns posts role selector to channel.
*/
async function activateRolePost(message, args, botdb) {
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);
  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }

  if (post.active) {
    try {
      const exMsg = await message.guild.channels.fetch(post.channel_id).then(async c => await c.messages.fetch(post.message_id));
      message.reply(`Post with label ${label} is already active at ${exMsg.url} !`);
    }
    catch {
      // if post was marked as active but we can't find the message, try and repost it. No error since user likely assumes it is not active.
      await makeRolePost(message, post, botdb);
    }
  }
  else { await makeRolePost(message, post, botdb); }
}

/**
* Deactivate a role post without deleting it from memory.
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns posts role selector to channel.
*/
async function deactivateRolePost(message, args, botdb) {
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);
  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }

  if (post.active) {
    try {
      const exMsg = await message.guild.channels.fetch(post.channel_id).then(async c => await c.messages.fetch(post.message_id));
      exMsg.delete();
      await botdb.run('UPDATE role_menu_messages SET active = 0 WHERE label = ? AND guild_id = ?', label, message.guild.id);
      return message.reply(`Post with label '${label}' deleted and deactivated. To remove it entirely from memory, use the 'delete' subcommand.`);
    }
    catch {
      await botdb.run('UPDATE role_menu_messages SET active = 0 WHERE label = ? AND guild_id = ?', label, message.guild.id);
      return message.reply(`Could not find discord message of post with label '${label}'!  I have marked it as inactive in my memory. To remove it entirely from memory, use the 'delete' subcommand.`);
    }
  }
  else {
    message.reply();
  }
}

/**
* Delete a role post from memory.
*
* @param message Discord message object
* @param args arguments passed when the command was sent
* @param botdb bot sqlite database object
*
* @returns posts role selector to channel.
*/
async function deleteRolePost(message, args, botdb) {
  const label = args.shift();
  if(!label) {
    return message.reply('Expected a label for the post');
  }

  const post = await getPostbyLabel(message, label, botdb);
  if (!post) { return message.reply(`Couldn't find a post with label '${label}'!`); }

  // check if message exists, just in case. If the message exists, do not continue.
  // Users should deactivate a post before deleting it.  This prevents users from accidentally deleting when they mean to deactivate.
  // TODO: slash command version reply with ephemeral prompt to user verifying their action.
  let exMsg;
  try {
    exMsg = await message.guild.channels.fetch(post.channel_id).then(async c => await c.messages.fetch(post.message_id));
  }
  catch { exMsg = null; }

  if (exMsg) {
    if (!post.active) {await botdb.run('UPDATE role_menu_messages SET active = 1 WHERE label = ? AND guild_id = ?', label, message.guild.id);}
    return message.reply(`Post with label '${label}' is active at ${exMsg.url} ! Use the deactivate subcommand first to unpost it, then the delete subcommand to eliminate it entirely from storage.`);
  }
  try {
    await botdb.run('DELETE FROM role_menu_messages WHERE message_id = ?', post.message_id);
    await botdb.run('DELETE FROM role_menu_emoji WHERE message_id = ?', post.message_id);
    return message.reply(`Post with label '${label}' deleted from storage. If you want to repost it you will need to recreate the post from scratch.`);
  }
  catch(err) {
    message.reply('Something went wrong deleting the post from storage! Please see logs for details.');
    console.error(err);
  }
}

async function listRolePosts(message, args, botdb) {
  const config = getConfig(message.client, message.guild.id);
  let msgString = new String;
  if (!args || args.length == 0) {
    msgString = `Here are the role posts for ${message.guild.name}:`;
    const postArr = await botdb.all('SELECT * FROM role_menu_messages WHERE guild_id = ?', message.guild.id);
    if (postArr) {
      await Promise.all(postArr.map(async p => {
        const channel = await message.guild.channels.fetch(p.channel_id);
        msgString += `\n**${p.label}** in ${channel} - ${p.active ? 'Active' : 'Inactive'}`;
      }));
      msgString += `\nTo see details on an individual message, use ${config.prefix}${exports.name} list <up to 5 labels separated by space>.`;
    }
    else { msgString = 'There are no active or inactive emojirole posts in this server!';}
  }
  else if (args.length <= 5) {
    msgString = 'Here is the list of emoji and roles for each label you requested:';
    let notFound = 0;
    await Promise.all(args.map(async l => {
      const post = await botdb.get('SELECT * FROM role_menu_messages WHERE label = ? AND guild_id = ?', l, message.guild.id);
      if (!post) {
        notFound++;
        msgString += `\nCould not find label ${l}`;
      }
      else {
        msgString += `\n**${l}:** (Active? ${post.active ? 'Yes' : 'No'})`;
        const emojiArr = await botdb.all('SELECT * FROM role_menu_emoji WHERE message_id =?', post.message_id);
        if(emojiArr.length > 0) {
          emojiArr.forEach(e => {
            msgString += `\n ${e.emoji} - ${e.name}`;
          });
        }
        else { msgString += '\nNo roles set up for this label.'; }
      }
    }));
    if (notFound == args.length && args.length > 1) { msgString = `Couldn't find role posts for any of the labels you requested on this server. try running *${config.prefix}${module.exports.name} list* to display all post labels for this server.`;}
    else if (notFound == args.length && args.length == 1) { msgString = `Couldn't find a role post with the label ${args[0]}`;}
  }
  else if (args.length > 5) {
    msgString = 'Too many labels requested! please limit request to 5 or less at a time.';
  }
  message.reply(msgString);
}