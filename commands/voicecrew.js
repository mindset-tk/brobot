const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);

module.exports = {
  name: 'voicecrew',
  description: 'Toggles voicecrew status for you or the person you mention',
  args: false,
  usage: '<@user>',
  guildOnly: true,
  execute(message) {
    let target = {};
    if (message.mentions.members.first()) {
      target = message.mentions.members.first();
    }
    else {
      target = message.member;
    }
    if (target.user.id == config.botID) {
      message.channel.send('I\'d love to join Voice Crew but I just can\'t. Sorry!');
      return;
    }
    if (message.member.roles.has(config.roleBros) && !target.roles.has(config.roleVoiceCrew)) {
      if (message.member == target) {
        message.channel.send('Adding you to Voice Crew!');
      }
      else { message.channel.send('Adding ' + target + ' to Voice Crew'); }
      target.addRole(config.roleVoiceCrew);
    }
    else if (message.member.roles.has(config.roleBros) && target.roles.has(config.roleVoiceCrew)) {
      if (message.member == target) {
        message.channel.send('Removed you from Voice Crew!');
      }
      else { message.channel.send('Removing ' + target + ' from Voice Crew'); }
      target.removeRole(config.roleVoiceCrew);
    }
    else {
      message.channel.send('You don\'t have permission to do that!');
    }
  },
};