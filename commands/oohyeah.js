module.exports = {
	name: 'oohyeah',
	aliases: ['ping', 'beep'],
	description: 'Pings bot to verify operation',
	cooldown: 3,
	execute(message) {
		message.channel.send('DIG IT!!');
	},
};