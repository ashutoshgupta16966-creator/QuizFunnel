require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to MongoDB');

    const Question = mongoose.model('Question', new mongoose.Schema({}, { strict: false }));
    const Room = mongoose.model('Room', new mongoose.Schema({}, { strict: false }));
    const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));

    const totalQuestions = await Question.countDocuments();
    console.log('Total Questions in DB:', totalQuestions);

    const defaultFilter = { $or: [{ roomCode: null }, { roomCode: { $exists: false } }] };
    const level1Default = await Question.countDocuments({ level: 1, ...defaultFilter });
    console.log('Level 1 default questions (roomCode null or missing):', level1Default);

    const level1Any = await Question.countDocuments({ level: 1 });
    console.log('Level 1 ANY questions:', level1Any);

    const rooms = await Room.find({}).select('roomCode quizTitle isAiGenerated questions participants status').lean();
    console.log('Total Rooms in DB:', rooms.length);
    rooms.forEach(r => {
      console.log(`Room ${r.roomCode}: isAiGenerated=${r.isAiGenerated}, status=${r.status}, questionsCount=${r.questions?.length || 0}, participantsCount=${r.participants?.length || 0}`);
    });

    const aiQuestions = await Question.countDocuments({ roomCode: { $ne: null, $exists: true } });
    console.log('Total questions with a roomCode in Question collection:', aiQuestions);

    const students = await Student.find({}).select('name mobile currentLevel status quizSession').lean();
    console.log('Total Students in DB:', students.length);
    students.slice(-5).forEach(s => {
      console.log(`Student ${s.name} (${s.mobile}): currentLevel=${s.currentLevel}, status=${s.status}, hasSession=${Boolean(s.quizSession)}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Diagnostic error:', err);
  }
}

test();
