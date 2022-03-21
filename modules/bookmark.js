const Discord = require('discord.js');
const { isTextChannel } = require('../extras/common.js');

exports.init = function(client) {
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
    const message = reaction.message;
    // If the message somehow doesn't have any reactions on it, or the channel type is not a guild text channel (like a DM for example),
    // do not emit a reaction add event.
    if (!reaction || !isTextChannel(message.channel)) return;

    if (message == null || message.system) return;

    if (reaction.emoji.name == '🔖') {
      console.log(`Attempting to PM a message from ${message.channel} to ${user}`);
      const messagesent = new Date(message.createdTimestamp).toLocaleString('en-US', { timeZone: 'UTC' });
      let image = '';
      let embedAuthor;
      if (message.member) {
        embedAuthor = message.member.displayName;
      }
      else {
        embedAuthor = message.author.username;
      }

      if (message.attachments.size > 0) {
        const isimage = /(jpg|jpeg|png|gif)/gi.test((message.attachments.array()[0].url).split('.'));
        if (isimage) { image = message.attachments.array()[0].url; }
      }
      const bookmarkEmbed = new Discord.MessageEmbed()
        .setColor('#0099ff')
        .setAuthor({ name: embedAuthor, url: message.author.displayAvatarURL() })
        .setDescription(message.content + '\n\n [jump to message](' + message.url + ')')
        .setFooter({ text: 'Bookmarked message was sent at ' + messagesent + ' UTC' })
        .setImage(image);
      user.send({ contents: `🔖: - from ${message.channel}`, embeds: [bookmarkEmbed] });
      return;
    }
  });
};
