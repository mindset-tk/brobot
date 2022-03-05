const { getConfig } = require('../extras/common.js');

module.exports = {
  name: 'elevatestaff',
  aliases: ['bro'],
  description() { return 'Elevates other users to staff status';},
  cooldown: 3,
  guildOnly: true,
  async execute(message) {
    const config = getConfig(message.client, message.guild.id);
    if (message.mentions.members.first()) {
      const target = message.mentions.members.first();
      const targetRole = await message.guild.roles.fetch(config.roleStaff);
      if (!target.roles.cache.has(config.roleStaff) && !target.bot) {
        message.channel.send('Elevating ' + target.displayName + ' to ' + targetRole.name + '!');
        target.roles.add(config.roleStaff);
      }
      else if (target.bot) {
        message.channel.send('The ' + targetRole.name + ' role is not used for bots!');
      }
      else if (target.roles.cache.has(config.roleStaff)) {
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