// needs rewrite for multi-server
// TODO: boolean pinning/unpinning instead of pin counting
const { getConfig, isTextChannel } = require('../extras/common.js');

exports.init = async function(client) {
  client.on('messageReactionAdd', async (reaction) => {
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
    const message = reaction.message;
    // If the message somehow doesn't have any reactions on it, or the channel type is not a guild text channel (like a DM for example),
    // do not emit a reaction add event.
    if (!reaction || !isTextChannel(message.channel)) return;

    if (message == null || message.system) return;

    // then get server-specific config info.
    const config = getConfig(client, message.guild.id);

    if (message == null || message.system) return;
    if (reaction.emoji.name == '📌' && reaction.count >= config.pinsToPin && !message.pinned && !config.pinIgnoreChannels.includes(message.channel.id)) {
      console.log(`Attempting to pin a message in ${message.channel}`);
      message.pin();
      return;
    }
  });
};
