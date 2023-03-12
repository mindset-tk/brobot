// This module will notify the channel if a topic is changed, since discord doesn't really notify anyone on a topic adjustment.
// if you don't need it at all it can be deleted.
// TODO: Add config item to toggle this feature.

const { isTextChannel } = require('../extras/common.js');

exports.init = async function(client) {
  client.on('channelUpdate', async (oldChannel, newChannel) => {
    if(!isTextChannel(newChannel)) {return;}
    if (oldChannel.topic != newChannel.topic) {
      const server = client.guilds.cache.get(oldChannel.guild.id);
      const channelupdateentry = await server.fetchAuditLogs().then(auditLogs => {
      // Find the most recent audit log that corresponds to the topic change.
      // normally this will be the very first one so check that immediately.
        if (auditLogs.entries.first().action === 'CHANNEL_UPDATE') {
          return auditLogs.entries.first();
        }
        else {
          for(const entry of auditLogs.entries()) {
            if (entry.action === 'CHANNEL_UPDATE') {
              return entry;
            }
          }
        }
      });
      newChannel.send(`${channelupdateentry.executor} has changed the topic to: \n *${newChannel.topic}*`);
    }
  });
};