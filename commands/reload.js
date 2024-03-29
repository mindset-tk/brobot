/*
const fs = require('fs');
const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);
const moment = require('moment-timezone');
const wait = require('util').promisify(setTimeout);
*/

module.exports = {
  name: 'reload',
  description() {return 'Reloads a command without restarting the bot';},
  usage() {return '[command name]';},
  cooldown: 3,
  guildOnly: true,
  staffOnly: true,
  args: true,
  async execute(message, args) {
    const commandName = args[0].toLowerCase();
    const command = message.client.commands.get(commandName)
    || message.client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

    if (!command) return message.channel.send(`There is no command with name or alias \`${commandName}\``);
    delete require.cache[require.resolve(`./${command.name}.js`)];
    try {
      const newCommand = require(`./${command.name}.js`);
      message.client.commands.set(newCommand.name, newCommand);
    }
    catch (error) {
      console.error(error);
      message.channel.send(`There was an error while reloading a command \`${command.name}\`:\n\`${error.message}\``);
    }
    message.channel.send(`Command \`${command.name}\` was reloaded`);
  },
};