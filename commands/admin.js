const { getConfig } = require('../extras/common.js');

module.exports = {
  name: 'admin',
  aliases: [],
  description() { return 'Toggle admin powers. Will not work if admin role is not configured in config. Announces with an @everyone ping to the announcements channel.';},
  cooldown: 3,
  guildOnly: true,
  staffOnly: true,
  execute(message) {
    const config = getConfig(message.client, message.guild.id);
    const client = message.client;
    const announcements = client.channels.cache.get(config.channelAnnouncements);
    if (!config.roleAdmin || !config.adminHoistToggle) { return; }
    if (!message.member.roles.cache.has(config.roleAdmin)) {
      message.channel.send('Elevating you to Admin.');
      if (announcements) { announcements.send('@everyone : ' + message.member.displayName + ' has escalated to admin!'); }
      message.member.roles.add(config.roleAdmin);
    }
    else if (message.member.roles.cache.has(config.roleAdmin)) {
      message.channel.send('De-elevating you from Admin.');
      if (announcements) { announcements.send('@everyone : ' + message.member.displayName + ' has de-escalated from admin!'); }
      message.member.roles.remove(config.roleAdmin);
    }
  },
};