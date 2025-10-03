const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { handleMessage } = require('./handles/message');
const { handlePostback } = require('./handles/Postback');
const config = require('./configure.json'); // ✅ Roles and admin IDs

const app = express();
app.use(express.json());

// ✅ Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const VERIFY_TOKEN = config.verifyToken || 'pagebot'; // ✅ from configure.json or fallback
const PAGE_ACCESS_TOKEN = fs.readFileSync('token.txt', 'utf8').trim();
const COMMANDS_PATH = path.join(__dirname, 'commands');

// ✅ Webhook verification
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  res.sendStatus(400);
});

// ✅ Webhook events
app.post('/webhook', (req, res) => {
  const { body } = req;

  if (body.object === 'page') {
    body.entry?.forEach(entry => {
      entry.messaging?.forEach(event => {
        if (event.message) {
          handleMessage(event, PAGE_ACCESS_TOKEN);
        } else if (event.postback) {
          handlePostback(event, PAGE_ACCESS_TOKEN);
        }
      });
    });

    return res.status(200).send('EVENT_RECEIVED');
  }

  res.sendStatus(404);
});

// ✅ Utility: send Messenger Profile API requests
const sendMessengerProfileRequest = async (method, url, data = null) => {
  try {
    const response = await axios({
      method,
      url: `https://graph.facebook.com/v21.0${url}?access_token=${PAGE_ACCESS_TOKEN}`,
      headers: { 'Content-Type': 'application/json' },
      data
    });
    return response.data;
  } catch (error) {
    console.error(`Error in ${method} request:`, error.response?.data || error.message);
    throw error;
  }
};

// ✅ Load commands dynamically (only for menu, role-checking done in handleMessage)
const loadCommands = () => {
  return fs.readdirSync(COMMANDS_PATH)
    .filter(file => file.endsWith('.js'))
    .map(file => {
      const command = require(path.join(COMMANDS_PATH, file));

      // 🔑 Only expose commands the user can see (hide admin-only if not needed in menu)
      if (command.role === 0) {
        return { name: `${command.name} (Admin)`, description: command.description };
      }

      return command.name && command.description
        ? { name: command.name, description: command.description }
        : null;
    })
    .filter(Boolean);
};

// ✅ Load menu commands into Messenger Profile
const loadMenuCommands = async (isReload = false) => {
  const commands = loadCommands();

  if (isReload) {
    await sendMessengerProfileRequest('delete', '/me/messenger_profile', { fields: ['commands'] });
    console.log('Menu commands deleted successfully.');
  }

  await sendMessengerProfileRequest('post', '/me/messenger_profile', {
    commands: [{ locale: 'default', commands }],
  });

  console.log('Menu commands loaded successfully.');
};

// ✅ Watch for changes in commands folder (auto reload menu)
fs.watch(COMMANDS_PATH, (eventType, filename) => {
  if (['change', 'rename'].includes(eventType) && filename.endsWith('.js')) {
    loadMenuCommands(true).catch(error => {
      console.error('Error reloading menu commands:', error);
    });
  }
});

// ✅ Start server
const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  try {
    await loadMenuCommands(); // Initial load
  } catch (error) {
    console.error('Error loading initial menu commands:', error);
  }
});