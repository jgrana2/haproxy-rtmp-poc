require('dotenv').config(); // Load .env file for environment variables
const NodeMediaServer = require('node-media-server');
const OpenAI = require('openai'); // Import OpenAI for audio transcriptions
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Initialize OpenAI instance with API key
const { spawn } = require('child_process');
const fs = require('fs');
const wav = require('wav');
const WebSocket = require('ws'); // Import WebSocket library

// Initialize the transcriptions array outside of functions
const transcriptions = [];

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    mediaroot: './media',
    webroot: './www',
    allow_origin: '*'
  },
  trans: {
    ffmpeg: './ffmpeg.exe', // Path to FFmpeg
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        dash: true,
        dashFlags: '[f=dash:window_size=3:extra_window_size=5]'
      }
    ]
  }
};

var nms = new NodeMediaServer(config);
console.log("Jose's Node Media Server");
nms.run();

// Set up WebSocket server
const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket Server running on ws://localhost:8080");

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send transcriptions to the client when they are added
  const interval = setInterval(() => {
    if (transcriptions.length > 0) {
      ws.send(JSON.stringify(transcriptions));
      transcriptions.length = 0; // Clear the transcriptions after sending
    }
  }, 1000); // Adjust the interval as needed

  ws.on('close', () => {
    clearInterval(interval);
    console.log('Client disconnected');
  });
});

nms.on('preConnect', (id, args) => {
  console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('postPublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

  const audioChunks = []; // Collect audio chunks
  const chunkDuration = 10000; // Duration to collect chunks in milliseconds (5 seconds)
  
  const ffmpeg = spawn(config.trans.ffmpeg, [
    '-i', `rtmp://127.0.0.1${StreamPath}`,
    '-f', 's16le',
    '-ar', '16000', // Set to 16000 Hz
    '-ac', '1', // Mono channel
    'pipe:1' // Output audio to stdout
  ]);

  const chunkTimer = setInterval(async () => {
    if (audioChunks.length > 0) {
      const startTime = Date.now();
      const audioBuffer = Buffer.concat(audioChunks); // Concatenate collected chunks
      await sendAudioToSTT(audioBuffer, startTime); // Pass startTime to STT service
      audioChunks.length = 0; // Clear the chunks for the next collection
    }
  }, chunkDuration);

  ffmpeg.stdout.on('data', (chunk) => {
    audioChunks.push(chunk); // Collect audio chunks
  });

  ffmpeg.on('exit', (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    clearInterval(chunkTimer); // Stop listening for new chunks
  });
});

// Function to send audio buffer to STT service
async function sendAudioToSTT(audioBuffer, startTime) {
  try {
    const audioFilePath = './temp_audio.wav'; // Save audio buffer to a temporary file
    const wavFile = new wav.Writer({
      channels: 1,
      sampleRate: 16000,
      bitDepth: 16,
    });

    const writeStream = fs.createWriteStream(audioFilePath);
    wavFile.pipe(writeStream);
    
    wavFile.write(audioBuffer);
    wavFile.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Use OpenAI's transcription API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
    });

    const utcMinusFiveHours = -5 * 60; // Offset in minutes
    const duration = audioBuffer.length / (16000 * 2); // Duration in seconds (16-bit, mono)
    const endTime = startTime + duration * 1000; // Convert to milliseconds
    
    // Convert time to Date object for formatting
    const startTimeDate = new Date(startTime);
    const endTimeDate = new Date(endTime);
    const adjustedstartTimeDate = new Date(startTimeDate.getTime() + (utcMinusFiveHours * 60 * 1000));
    const adjustedEndTimeDate = new Date(endTimeDate.getTime() + (utcMinusFiveHours * 60 * 1000));

    // Format transcription using the existing function
    const jsonLine = formatTranscriptionAsJSONLine(transcription.text, adjustedstartTimeDate, adjustedEndTimeDate);

    // Push the formatted transcription line into the transcriptions array
    transcriptions.push(jsonLine);

    console.log(transcriptions); // Printing updated transcriptions

  } catch (error) {
    console.error('Error transcribing audio:', error.response ? error.response.data : error.message);
  }
}

// Keep the formatTranscriptionAsJSONLine function
function formatTranscriptionAsJSONLine(text, startTime, endTime) {
  const startTimeSRT = new Date(startTime).toISOString().substr(11, 8) + ',' + (startTime % 1000).toString().padStart(3, '0');
  const endTimeSRT = new Date(endTime).toISOString().substr(11, 8) + ',' + (endTime % 1000).toString().padStart(3, '0');

  return {
    start: startTimeSRT,
    end: endTimeSRT,
    text: text
  };
}