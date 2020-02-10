const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);

module.exports = {
	name: 'help',
	description: 'List all of my commands or info about a specific command.',
	aliases: ['commands'],
	usage: '[command name]',
	cooldown: 5,
	execute(message, args) {
		const data = [];
		const { commands } = message.client;
		if (!args.length) {
			data.push('Here\'s a list of all my commands:');
			// map all command names to an array, filter(Boolean) to remove empty values, then join for clean output
			data.push(commands.map(command => command.name).filter(Boolean).join('\n'));
			data.push(`You can send \`${config.prefix}help [command name]\` to get info on a specific command!`);

			return message.channel.send(data, { split: true });
		}
		const name = args[0].toLowerCase();
		const command = commands.get(name) || commands.find(c => c.aliases && c.aliases.includes(name));

		if (!command) {
			return message.reply('that\'s not a valid command!');
		}

		data.push(`**Name:** ${command.name}`);

		if (command.aliases) data.push(`**Aliases:** ${command.aliases.join(', ')}`);
		if (command.description) data.push(`**Description:** ${command.description}`);
		if (command.usage) data.push(`**Usage:** ${config.prefix}${command.name} ${command.usage}`);

		message.channel.send(data, { split: true });

	},
};