const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);


module.exports = {
  name: 'voicecrew',
  description: 'Toggles voicecrew status for you or the person you mention',
  args: false,
  usage: '<@user>',
  guildOnly: true,
  guildLimit: ['598939818600300550'],
  execute(message, args, client, msgguildid) {
    let target = {};
    if (message.mentions.members.first()) {
      target = message.mentions.members.first();
    }
    else {
      target = message.member;
    }
    if (target.bot) {
      message.channel.send('Bots can\'t join voice crew!');
      return;
    }
    if (message.member.roles.cache.has(config[msgguildid].roleUser) && !target.roles.has(config[msgguildid].roleVoiceCrew)) {
      if (message.member == target) {
        message.channel.send('Adding you to Voice Crew!');
      }
      else { message.channel.send('Adding ' + target + ' to Voice Crew'); }
      target.addRole(config[msgguildid].roleVoiceCrew);
    }
    else if (message.member.roles.cache.has(config[msgguildid].roleUser) && target.roles.has(config[msgguildid].roleVoiceCrew)) {
      if (message.member == target) {
        message.channel.send('Removed you from Voice Crew!');
      }
      else { message.channel.send('Removing ' + target + ' from Voice Crew'); }
      target.removeRole(config[msgguildid].roleVoiceCrew);
    }
    else {
      message.channel.send('You don\'t have permission to do that!');
    }
  },
};