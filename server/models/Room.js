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
  isReattempt:    { type: Boolean, default: false },
  joinedAt:       { type: Date, default: Date.now },
  lastActive:     { type: Date, default: Date.now },
}, { _id: false });

const ReattemptRequestSchema = new mongoose.Schema({
  mobile:         { type: String, required: true },
  name:           { type: String, required: true },
  branch:         { type: String, default: 'CSE' },
  status:         { type: String, enum: ['pending', 'approved', 'denied', 'consumed'], default: 'pending' },
  requestedAt:    { type: Date, default: Date.now },
  previousStatus: { type: String, default: 'completed' },
  previousScore:  { type: Number, default: 0 },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  // roomCode is NOT globally unique — uniqueness is scoped to (adminPhone + roomCode) for ACTIVE rooms only.
  // Different hosts can reuse the same room code. Enforced at application layer below.
  roomCode:     { type: String, required: true, uppercase: true, trim: true, index: true },
  quizTitle:    { type: String, trim: true, default: '' },
  adminName:    { type: String, required: true, trim: true },
  adminPhone:   { type: String, required: true, trim: true, index: true },
  roomPassword: { type: String, required: true },
  maxCapacity:  { type: Number, default: 60 },
  status:       { type: String, enum: ['active', 'closed'], default: 'active' },
  participants: [ParticipantSchema],
  reattemptRequests: [ReattemptRequestSchema],
}, { timestamps: true });

// Compound index: quick lookups per phone + code + status
RoomSchema.index({ adminPhone: 1, roomCode: 1, status: 1 });
// Index for "My Live Rooms" — fetch all rooms by phone sorted by creation date
RoomSchema.index({ adminPhone: 1, createdAt: -1 });

module.exports = mongoose.model('Room', RoomSchema);

