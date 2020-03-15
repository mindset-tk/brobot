const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);

module.exports = {
  name: 'bro',
  description: 'Elevates other users to bro status',
  args: true,
  usage: '<@user>',
  guildOnly: true,
  execute(message) {
    if (message.mentions.members.first()) {
      const target = message.mentions.members.first();
      if (message.member.roles.has(config.roleBros) && !target.roles.has(config.roleBros) && target.user.id !== config.botID) {
        message.channel.send('Elevating ' + target + ' to Bro');
        target.addRole(config.roleBros);
      }
      else if (target.user.id == config.botID) {
        message.channel.send('The Bros role is not used for bots!');
      }
      else if (target.roles.has(config.roleBros)) {
        message.channel.send(target + ' is already a member of the Bros role!');
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