const Room = require('../models/Room');

/**
 * Socket.io room management handlers.
 * Isolates real-time events to live quiz rooms only.
 */
function initRoomSocket(io) {
  io.on('connection', (socket) => {
    // Admin joins their live room dashboard room
    socket.on('admin:join-room', async ({ roomCode, roomPassword }) => {
      try {
        if (!roomCode) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        const room = await Room.findOne({ roomCode: normalizedCode });
        if (!room) {
          socket.emit('error:room', { message: 'Room not found' });
          return;
        }
        if (room.roomPassword !== roomPassword) {
          socket.emit('error:room', { message: 'Invalid room password' });
          return;
        }

        socket.join(`room:${normalizedCode}`);
        socket.emit('admin:joined-success', {
          roomCode: room.roomCode,
          adminName: room.adminName,
          status: room.status,
          maxCapacity: room.maxCapacity,
          participants: room.participants || [],
          reattemptRequests: (room.reattemptRequests || []).filter((r) => r.status === 'pending'),
        });
      } catch (err) {
        console.error('Socket admin:join-room error:', err.message);
      }
    });

    // Student joins the room socket session
    socket.on('student:join-room', async ({ roomCode, student }) => {
      try {
        if (!roomCode || !student?.mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        socket.join(`room:${normalizedCode}`);

        // Notify admin in this room
        io.to(`room:${normalizedCode}`).emit('student:joined', {
          mobile: student.mobile,
          name: student.name,
          branch: student.branch,
          level: 1,
          score: 0,
          timeTaken: 0,
          status: 'in-progress',
          isDisqualified: false,
          joinedAt: new Date(),
        });
      } catch (err) {
        console.error('Socket student:join-room error:', err.message);
      }
    });

    // Student emits live progress update (level up, score change, completion, etc.)
    socket.on('student:progress', async ({ roomCode, mobile, level, score, timeTaken, status, isDisqualified }) => {
      try {
        if (!roomCode || !mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();

        // Broadcast to admin room
        io.to(`room:${normalizedCode}`).emit('student:updated', {
          mobile,
          level,
          score,
          timeTaken,
          status,
          isDisqualified: Boolean(isDisqualified),
          lastActive: new Date(),
        });

        // Persist update in Room document
        await Room.updateOne(
          { roomCode: normalizedCode, 'participants.mobile': mobile },
          {
            $set: {
              'participants.$.level': level,
              'participants.$.score': score,
              'participants.$.timeTaken': timeTaken,
              'participants.$.status': status,
              'participants.$.isDisqualified': Boolean(isDisqualified),
              'participants.$.lastActive': new Date(),
            },
          }
        );
      } catch (err) {
        console.error('Socket student:progress error:', err.message);
      }
    });

    // Disqualification notification
    socket.on('student:disqualified', async ({ roomCode, mobile }) => {
      try {
        if (!roomCode || !mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();

        io.to(`room:${normalizedCode}`).emit('student:disqualified', { mobile });

        await Room.updateOne(
          { roomCode: normalizedCode, 'participants.mobile': mobile },
          {
            $set: {
              'participants.$.status': 'eliminated',
              'participants.$.isDisqualified': true,
              'participants.$.lastActive': new Date(),
            },
          }
        );
      } catch (err) {
        console.error('Socket student:disqualified error:', err.message);
      }
    });

    // Admin closes room
    socket.on('admin:close-room', async ({ roomCode }) => {
      try {
        if (!roomCode) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        io.to(`room:${normalizedCode}`).emit('room_closed', {
          message: 'The Host has ended this room session. 🚪',
        });
        io.to(`room:${normalizedCode}`).emit('room:closed', {
          message: 'The Host has ended this room session. 🚪',
        });
      } catch (err) {
        console.error('Socket admin:close-room error:', err.message);
      }
    });
  });
}

module.exports = { initRoomSocket };
