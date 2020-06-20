const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);


module.exports = {
  name: 'unbro',
  description: 'De-escalates users from bro status',
  args: true,
  usage: '<@user>',
  guildOnly: true,
  guildLimit: ['598939818600300550'],
  execute(message, args, client, msgguildid) {
    if (message.mentions.members.first()) {
      const target = message.mentions.members.first();
      if (message.member.roles.cache.has(config[msgguildid].roleUser) && target.roles.has(config[msgguildid].roleUser)) {
        message.channel.send('Removing bro status from ' + target + '.');
        target.removeRole(config[msgguildid].roleUser);
      }
      else if(!target.roles.has(config[msgguildid].roleUser)) {
        message.channel.send(target + ' is not a member of the Bros role!');
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