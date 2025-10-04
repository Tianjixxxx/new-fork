const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { sendMessage } = require('./message');
const config = require('../configure.json');

const commands = new Map();
const prefix = '';

const commandFiles = fs.readdirSync(path.join(__dirname, '../cmds')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`../cmds/${file}`);
    commands.set(command.name.toLowerCase(), command);
    console.log(`Loaded command: ${command.name}`);
}

async function handleMessage(event, pageAccessToken) {
    if (!event?.sender?.id) {
        console.error('Invalid event object: Missing sender ID.');
        return;
    }

    const senderId = event.sender.id;

    if (event.message?.text) {
        const messageText = event.message.text.trim();
        console.log(`Received message: ${messageText}`);

        const words = messageText.split(' ');
        const commandName = words.shift().toLowerCase();
        const args = words;

        console.log(`Parsed command: ${commandName} with arguments: ${args}`);

        if (commands.has(commandName)) {
            const command = commands.get(commandName);

            if (command.role === 0 && !config.adminId.includes(senderId)) {
                sendMessage(senderId, { text: 'You are not authorized to use this command.' }, pageAccessToken);
                return;
            }

            try {
                let imageUrl = '';

                if (event.message?.reply_to?.mid) {
                    try {
                        imageUrl = await getAttachments(event.message.reply_to.mid, pageAccessToken);
                    } catch (error) {
                        console.error("Failed to get attachment:", error);
                        imageUrl = '';
                    }
                } else if (event.message?.attachments?.[0]?.type === 'image') {
                    imageUrl = event.message.attachments[0].payload.url;
                }

                await command.execute(senderId, args, pageAccessToken, event, imageUrl);
            } catch (error) {
                console.error(`Error executing command "${commandName}":`, error);
                sendMessage(senderId, { text: 'There was an error executing that command.' }, pageAccessToken);
            }
        } else {
            const defaultCommand = commands.get('ai');
            if (defaultCommand) {
                try {
                    await defaultCommand.execute(senderId, [messageText], pageAccessToken, event);
                } catch (error) {
                    console.error('Error executing default "ai" command:', error);
                    sendMessage(senderId, { text: 'There was an error processing your request.' }, pageAccessToken);
                }
            } else {
                sendMessage(senderId, { text: "Sorry, I couldn't understand that. Please try again." }, pageAccessToken);
            }
        }
    } else {
        console.error('Message or text is not present in the event.');
    }
}

async function getAttachments(mid, pageAccessToken) {
    if (!mid) {
        console.error("No message ID provided for getAttachments.");
        throw new Error("No message ID provided.");
    }

    try {
        const { data } = await axios.get(`https://graph.facebook.com/v21.0/${mid}/attachments`, {
            params: { access_token: pageAccessToken }
        });

        if (data?.data?.length > 0 && data.data[0].image_data) {
            return data.data[0].image_data.url;
        } else {
            console.error("No image found in the replied message.");
            throw new Error("No image found in the replied message.");
        }
    } catch (error) {
        console.error("Error fetching attachments:", error.response?.data || error.message);
        throw new Error("Failed to fetch attachments.");
    }
}

module.exports = { handleMessage };