const { getConfig } = require('../extras/common.js');

module.exports = {
  name: 'elevatemember',
  description() { return 'Elevates a user to member status';},
  cooldown: 3,
  guildOnly: true,
  async execute(message) {
    const config = getConfig(message.client, message.guild.id);
    if (message.mentions.members.first()) {
      const target = message.mentions.members.first();
      const targetRole = await message.guild.roles.fetch(config.roleUser);
      if (!target.roles.cache.has(config.roleUser) && !target.bot) {
        message.channel.send('Elevating ' + target.displayName + ' to ' + targetRole.name + '!');
        target.roles.add(config.roleUser);
      }
      else if (target.bot) {
        message.channel.send('The ' + targetRole.name + ' role is not used for bots!');
      }
      else if (target.roles.cache.has(config.roleUser)) {
        message.channel.send(target.displayName + ' is already a member of the ' + targetRole.name + ' role!');
      }
      else {
        message.channel.send('You don\'t have permission to do that!');
      }
    }
    else {
      message.channel.send('You did not @mention a user on this server!');
    }
  },
};