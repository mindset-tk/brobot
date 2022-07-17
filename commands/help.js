const { getMessagePermLevel, getConfig } = require('../extras/common.js');

module.exports = {
  name: 'help',
  description() { return 'List all of my commands or info about a specific command.';},
  aliases: ['commands'],
  usage() {return '[command name]';},
  cooldown: 3,
  execute(message, args) {
    const config = getConfig(message.client, message.guild.id);
    const permLevel = getMessagePermLevel(message);
    let data = new String;
    const { commands } = message.client;
    // If the help invoker is staff, give all commands.
    if (args.length < 1 && permLevel == 'staff') {
      data += 'Here\'s a list of all my commands:\n';
      // map all command names to an array, filter(Boolean) to remove empty values, then join for clean output
      data += commands.map(command => command.name).filter(Boolean).join('\n');
      data += `\nYou can send \`${config.prefix}help [command name]\` to get info on a specific command!`;
      return message.channel.send({ content: data });
    }
    // If the invoker is not staff, but has permission to invoke the command, give only commands available to them.
    if (args.length < 1 && permLevel == 'user') {
      data += 'Here\'s a list of commands available to you:\n';
      // map all non-staffOnly command names to an array, filter(Boolean) to remove empty values, then join for clean output
      data += commands.map(command => {if (!command.staffOnly) return command.name;}).filter(Boolean).join('\n');
      data += `\nYou can send \`${config.prefix}help [command name]\` to get info on a specific command!`;

      return message.channel.send({ content: data });
    }
    const name = args[0].toLowerCase();
    const command = commands.get(name) || commands.find(c => c.aliases && c.aliases.includes(name));

    if (!command || (command.staffOnly && permLevel != 'staff')) {
      return message.reply('that\'s not a valid command, or you don\'t have permission to use it!');
    }

    data += `**Name:** ${command.name}`;

    if (command.aliases) data += (`\n**Aliases:** ${command.aliases.join(', ')}`);
    if (command.description) data += (`\n**Description:** ${command.description(config)}`);
    if (command.usage) data += (`\n**Usage:** ${config.prefix}${command.name} ${command.usage(config)}`);

    return message.channel.send({ content: data, split: true });
  },
};