// require the filesystem and discord.js modules, and pull data from config.json
const fs = require('fs');
const Discord = require('discord.js');
const { prefix, authtoken, serverID } = require('./config.json');

// initialize client, commands, command cooldown collections
const client = new Discord.Client();
client.commands = new Discord.Collection();
const cooldowns = new Discord.Collection();

// read command files
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	// set a new item in the Collection
	// with the name attribute as the command name and the value as the exported module
	client.commands.set(command.name, command);
}

// initialize raw events to listen for
const events = {
	// reaction events
	MESSAGE_REACTION_ADD: 'messageReactionAdd',
	MESSAGE_REACTION_REMOVE: 'messageReactionRemove',
	RESUMED: 'Reconnected',
};

// when the client is ready, run this code.
// should trigger every time the bot returns to ready state.
client.on('ready', () => {
	console.log('Ready!');
	client.user.setActivity('Wrestlemania', { type: 'WATCHING' });
});

// login to Discord with your app's token
client.login(authtoken);


client.on('message', message => {
	if (message.type == 'PINS_ADD') {
		message.delete();
		return;
	}
	if (!message.content.startsWith(prefix) || message.author.bot) return;

	const args = message.content.slice(prefix.length).split(/ +/);
	const commandName = args.shift().toLowerCase();

	// checking both command names and aliases, else return from function
	const command = client.commands.get(commandName)
	|| client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
	if (!command) return;

	// check if command is server only
	if (command.guildOnly && message.channel.type !== 'text') {
		return message.reply('I can\'t execute that command inside DMs!');
	}

	// check if command requires arguments
	if (command.args && !args.length) {
		let reply = 'You didn\'t provide any arguments!';
		if (command.usage) {
			reply += `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``;
		}
		return message.channel.send(reply);
	}

	// check cooldown status
	if (!cooldowns.has(command.name)) {
		cooldowns.set(command.name, new Discord.Collection());
	}

	const now = Date.now();
	const timestamps = cooldowns.get(command.name);
	const cooldownAmount = (command.cooldown || 0.1) * 1000;

	if (timestamps.has(message.author.id)) {
		const expirationTime = timestamps.get(message.author.id) + cooldownAmount;
		if (now < expirationTime) {
			const timeLeft = (expirationTime - now) / 1000;
			return message.channel.send(`please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${command.name}\` command.`);
		}
	}
	timestamps.set(message.author.id, now);
	setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

	try {
		command.execute(message, args, client);
	}
	catch (error) {
		console.error(error);
		message.reply('there was an error trying to execute that command!');
	}

});

// reads channel updates and reports topic change to channel
client.on('channelUpdate', async (oldChannel, newChannel) => {
	const server = client.guilds.get(serverID);
	const channelupdateentry = await server.fetchAuditLogs().then(audit => audit.entries.first());
	if (oldChannel.topic != newChannel.topic) {
		newChannel.send(channelupdateentry.executor + ' has changed the topic to: \n *' + newChannel.topic + '*');
	}
});

// Raw packet listener and event emitter.
client.on('raw', async packet => {
	// console.log(packet);
	// ensure the 't' field exists on any packet read; return if it does not.
	// eslint-disable-next-line no-prototype-builtins
	if (!events.hasOwnProperty(packet.t)) return;
	// check if it is a reconnect packet and emit reconnection event.
	if (packet.t === 'RESUMED') {
		client.emit(events[packet.t]);
		return;
	}
	else {
		const { d: data } = packet;
		const user = client.users.get(data.user_id);
		const channel = client.channels.get(data.channel_id) || await user.createDM();

		// prevent confusion between cached and uncached messages; ensure event only occurs once per message
		// this may not be working as expected.
		// if (channel.messages.has(data.message_id)) return;

		// get message and emoji info
		const message = await channel.fetchMessage(data.message_id);
		const emojiKey = (data.emoji.id) ? `${data.emoji.name}:${data.emoji.id}` : data.emoji.name;

		let reaction = message.reactions.get(emojiKey);

		if (!reaction) {
			// Create an object that can be passed through the event to prevent errors.
			const emoji = new Discord.Emoji(client.guilds.get(data.guild_id), data.emoji);
			reaction = new Discord.MessageReaction(message, emoji, 1, data.user_id === client.user.id);
		}
		client.emit(events[packet.t], reaction, user, message);
	}
});

// handlers for reaction added/removed
client.on('messageReactionAdd', (reaction, user, message) => {
	if (message == null || message.pinned || message.system) return;
	if (reaction.emoji.name == '📌') {
		const guild = message.guild;
		const guildmember = guild.member(user);
		console.log(`${user.username} wants to pin a message.`);
		message.channel.send(
			{ embed: {
				title: guildmember.nickname + ' has pinned a message.',
				description: '[click here to go to the message](' + message.url + ')',
				fields: [],
			},
			});
		message.pin();
		return;
	}
});

client.on('messageReactionRemove', (reaction, user, message) => {
	if (reaction.emoji.name == '📌') {
		if (message == null || message.system || !message.pinned) return;
		const guild = message.guild;
		const guildmember = guild.member(user);
		console.log(`${user.username} wants to unpin a message.`);
		message.channel.send(
			{ embed: {
				title: guildmember.nickname + ' has unpinned a message.',
				description: '[click here to go to the message](' + message.url + ')',
				fields: [],
			},
			});
		message.unpin();
		return;
	}
});

client.on('Reconnected', () => {
	console.log('Reconnected!');
});

// very basic error handling.
// console will log the error but take no further action.
// if the error is not fatal the bot will continue running.
client.on('error', err => {
	const date = new Date().toLocaleString();
	const ErrTargetPrototype = Object.getPrototypeOf(err.target);
	// If the error is a network error, display error message.
	if (ErrTargetPrototype.constructor.name == 'WebSocket') {
		console.log('[' + date + ']: Connection Error! The error was: "' + err.message + '". Will automatically attempt to reconnect.');
		return;
	}
	// Else, display full error object.
	else {
		console.error('[' + date + ']:' + err);
		return;
	}
});