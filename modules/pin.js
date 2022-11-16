// needs rewrite for multi-server
// TODO: boolean pinning/unpinning instead of pin counting
const { getConfig, isTextChannel } = require('../extras/common.js');
const { MessageEmbed } = require('discord.js');

/**
 * Verify if a reacted message is valid for pinning;
 * Ensure that the reaction exists, the message is not null and is in a guild text channel,
 * the reaction is the correct emoji (📌), and that it's not a system message.
 * @param {*} reaction
 * @param {*} message
 * @returns {boolean}
 */
function isValidMessage(reaction, message) {
  return reaction
    && !(message == null)
    && isTextChannel(message.channel)
    && reaction.emoji.name == '📌'
    && !message.system;
}

/**
 * Check if a message is pinnable for count mode.
 * Ensure it has more pins than config.pinstopin,
 * is not already pinned,
 * and is not in a pinIgnore channel.
 * @param {*} message
 * @param {*} reaction
 * @param {*} config
 * @returns {boolean}
 */
function isPinnableCount(message, reaction, config) {
  return reaction.count >= config.pinsToPin
    && !message.pinned
    && !config.pinIgnoreChannels.includes(message.channel.id);
}

/**
 * Check if a message is pinnable for toggle mode.
 * Ensure it is not already pinned,
 * and is not in a pinIgnore channel.
 * @param {*} message
 * @param {*} reaction
 * @param {*} config
 * @returns {boolean}
 */
function isPinnableToggle(message, reaction, config) {
  return !message.pinned
    && !config.pinIgnoreChannels.includes(message.channel.id);
}

/**
 * Check if a message is pinnable for count mode.
 * Ensure it has fewer pins than config.pinstopin,
 * is already pinned,
 * and is not in a pinIgnore channel.
 * @param {*} message
 * @param {*} reaction
 * @param {*} config
 * @returns {boolean}
 */
function isUnpinnableCount(message, reaction, config) {
  return reaction.count < config.pinsToPin
    && message.pinned
    && !config.pinIgnoreChannels.includes(message.channel.id);
}

/**
 * Check if a message is pinnable for toggle mode.
 * Ensure it is not already pinned,
 * and is not in a pinIgnore channel.
 * @param {*} message
 * @param {*} reaction
 * @param {*} config
 * @returns {boolean}
 */
function isUnpinnableToggle(message, reaction, config) {
  return message.pinned
    && !config.pinIgnoreChannels.includes(message.channel.id);
}

exports.init = async function(client) {
  // Delete system pinning notifications for items the bot pins. Instead, the bot posts its own pin embed that's slightly more informative.
  client.on('messageCreate', async message =>{
    if (message.type == 'CHANNEL_PINNED_MESSAGE' && message.author.id == client.user.id) {
      return message.delete();
    }
  });

  // pinning process
  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      }
      catch (error) {
        console.error('Something went wrong when fetching the message: ', error);
        return;
      }
    }
    // fetch info about the message the reaction was added to.
    const message = await reaction.message.fetch();

    // return if it's not a pinnable message, or the emoji is not a pin emoji.
    if (!isValidMessage(reaction, message)) return;

    const guild = message.guild;
    const guildmember = await guild.members.fetch(user);

    // then get server-specific config info.
    const config = getConfig(client, message.guild.id);

    const pinEmbed = new MessageEmbed().setDescription(`[click here to go to the message](${message.url})`);
    if (config.pinMode == 'count') {
      if (!isPinnableCount(message, reaction, config)) {
        return;
      }
      pinEmbed.setTitle('A message has reached the pin threshold and been pinned.');
    }
    else if (config.pinMode == 'toggle') {
      if (!isPinnableToggle(message, reaction, config)) {
        return;
      }
      pinEmbed.setTitle(`${guildmember.displayName} has pinned a message.`);
    }
    console.log(`Attempting to pin a message in ${message.channel}`);
    try {
      message.pin();
      message.channel.send({ embeds: [pinEmbed] });
    }
    catch(err) {console.log('Error when unpinning message!', err);}
    return;
  });

  // unpinning process
  client.on('messageReactionRemove', async (reaction, user) => {
    if (reaction.partial) {
      try {
        await reaction.fetch();
      }
      catch (error) {
        console.error('Something went wrong when fetching the message: ', error);
        return;
      }
    }
    const message = await reaction.message.fetch();
    const config = getConfig(client, message.guild.id);
    if (!isValidMessage(reaction, message)) return;
    const guild = message.guild;
    const guildmember = await guild.members.fetch(user);
    const pinEmbed = new MessageEmbed().setDescription(`[click here to go to the message](${message.url})`);
    if (config.pinMode == 'count') {
      if (!isUnpinnableCount(message, reaction, config)) {
        return;
      }
      pinEmbed.setTitle('A message has dropped below the pin threshold and been unpinned.');
    }
    else if (config.pinMode == 'toggle') {
      if (!isUnpinnableToggle(message, reaction, config)) {
        return;
      }
      pinEmbed.setTitle(`${guildmember.displayName} has unpinned a message.`);
    }
    console.log(`Attempting to unpin a message in ${message.channel}`);
    try {
      message.unpin();
      message.channel.send({ embeds: [pinEmbed] });
    }
    catch(err) {console.log('Error when unpinning message!', err);}
    return;
  });
};