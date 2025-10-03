const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { sendMessage } = require('./message');
const config = require('../configure.json');

// ✅ Store commands
const commands = new Map();
const prefix = ''; // leave blank if you want raw commands, or set e.g. '-'

// ✅ Track last media per user
const lastImageByUser = new Map();
const lastVideoByUser = new Map();

// ✅ Load commands dynamically
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
    const attachments = event?.message?.attachments || [];

    // ✅ Detect media
    const imageAttachment = attachments.find(a => a.type === 'image');
    const videoAttachment = attachments.find(a => a.type === 'video');

    const imageUrl = imageAttachment?.payload?.url;
    const videoUrl = videoAttachment?.payload?.url;

    if (imageUrl) lastImageByUser.set(senderId, imageUrl);
    if (videoUrl) lastVideoByUser.set(senderId, videoUrl);

    const lastImage = imageUrl || lastImageByUser.get(senderId);
    const lastVideo = videoUrl || lastVideoByUser.get(senderId);
    const mediaToUpload = lastImage || lastVideo;

    if (event.message?.text) {
        const messageText = event.message.text.trim();
        console.log(`Received message: ${messageText}`);

        const words = messageText.startsWith(prefix)
            ? messageText.slice(prefix.length).split(' ')
            : messageText.split(' ');

        const commandName = words.shift().toLowerCase();
        const args = words;

        console.log(`Parsed command: ${commandName} with arguments: ${args}`);

        // ✅ Special media-related commands
        const mediaCommands = ['remini', 'catmoe', 'imgbb', 'restore', 'ocr', 'removebg', 'gemini', 'imgur', 'zombie', 'blur', 'vampire'];

        try {
            if (mediaCommands.includes(commandName)) {
                switch (commandName) {
                    case 'remini':
                    case 'restore':
                    case 'removebg':
                    case 'zombie':
                    case 'blur':
                    case 'vampire':
                        if (lastImage) {
                            await commands.get(commandName).execute(senderId, [], pageAccessToken, lastImage);
                            lastImageByUser.delete(senderId);
                        } else {
                            await sendMessage(senderId, { text: `❌ Please send an image first, then type "${commandName}".` }, pageAccessToken);
                        }
                        break;

                    case 'gemini':
                        await commands.get('gemini').execute(senderId, args, pageAccessToken, event, lastImage);
                        lastImageByUser.delete(senderId);
                        break;

                    case 'imgbb':
                    case 'imgur':
                        if (mediaToUpload) {
                            await commands.get(commandName).execute(senderId, [], pageAccessToken, mediaToUpload);
                            lastImageByUser.delete(senderId);
                            lastVideoByUser.delete(senderId);
                        } else {
                            await sendMessage(senderId, { text: `❌ Please send an image or video first, then type "${commandName}".` }, pageAccessToken);
                        }
                        break;

                    case 'ocr':
                    case 'catmoe':
                        if (mediaToUpload) {
                            await commands.get(commandName).execute(senderId, [], pageAccessToken, mediaToUpload);
                            lastImageByUser.delete(senderId);
                            lastVideoByUser.delete(senderId);
                        } else {
                            await sendMessage(senderId, { text: `❌ Please send an image first, then type "${commandName}".` }, pageAccessToken);
                        }
                        break;
                }
                return;
            }

            // ✅ Normal command
            if (commands.has(commandName)) {
                const command = commands.get(commandName);

                // Role check (role 0 = admin only)
                if (command.role === 0 && !config.adminId.includes(senderId)) {
                    sendMessage(senderId, { text: '🚫 You are not authorized to use this command.' }, pageAccessToken);
                    return;
                }

                let replyImageUrl = '';
                if (event.message?.reply_to?.mid) {
                    try {
                        replyImageUrl = await getAttachments(event.message.reply_to.mid, pageAccessToken);
                    } catch (err) {
                        console.error("Failed to get attachment:", err);
                    }
                }

                await command.execute(senderId, args, pageAccessToken, event, replyImageUrl || lastImage || lastVideo);
            } else if (commands.has('ai')) {
                // fallback AI
                await commands.get('ai').execute(senderId, [messageText], pageAccessToken, event);
            } else {
                await sendMessage(senderId, { text: "❓ Unknown command and AI fallback unavailable." }, pageAccessToken);
            }
        } catch (error) {
            console.error(`Error executing command "${commandName}":`, error);
            await sendMessage(senderId, { text: error.message || `❌ Error executing "${commandName}".` }, pageAccessToken);
        }
    } else {
        console.error('Message or text is not present in the event.');
    }
}

// ✅ Fetch attachments for replies
async function getAttachments(mid, pageAccessToken) {
    if (!mid) throw new Error("No message ID provided.");
    try {
        const { data } = await axios.get(`https://graph.facebook.com/v21.0/${mid}/attachments`, {
            params: { access_token: pageAccessToken }
        });
        if (data?.data?.length > 0 && data.data[0].image_data) {
            return data.data[0].image_data.url;
        } else {
            throw new Error("No image found in the replied message.");
        }
    } catch (error) {
        console.error("Error fetching attachments:", error.response?.data || error.message);
        throw new Error("Failed to fetch attachments.");
    }
}

module.exports = { handleMessage };