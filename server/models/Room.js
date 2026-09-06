const mongoose = require('mongoose');

const ParticipantSchema = new mongoose.Schema({
  mobile:         { type: String, required: true },
  name:           { type: String, required: true },
  branch:         { type: String, default: 'CSE' },
  level:          { type: Number, default: 1 },
  score:          { type: Number, default: 0 },
  timeTaken:      { type: Number, default: 0 },
  status:         {
    type: String,
    enum: ['in-progress', 'advanced', 'completed', 'eliminated', 'disqualified'],
    default: 'in-progress',
  },
  isDisqualified: { type: Boolean, default: false },
  joinedAt:       { type: Date, default: Date.now },
  lastActive:     { type: Date, default: Date.now },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  roomCode:     { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  adminName:    { type: String, required: true, trim: true },
  adminPhone:   { type: String, required: true, trim: true },
  roomPassword: { type: String, required: true },
  maxCapacity:  { type: Number, default: 60 },
  status:       { type: String, enum: ['active', 'closed'], default: 'active' },
  participants: [ParticipantSchema],
}, { timestamps: true });

module.exports = mongoose.model('Room', RoomSchema);
