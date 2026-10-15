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
        const enrichedParticipants = await Room.enrichParticipantsWithLevels(room.participants || [], normalizedCode);
        socket.emit('admin:joined-success', {
          roomCode: room.roomCode,
          adminName: room.adminName,
          status: room.status,
          maxCapacity: room.maxCapacity,
          quizStarted: Boolean(room.quizStarted),
          levelTimers: Array.isArray(room.levelTimers) ? room.levelTimers : [],
          participants: enrichedParticipants,
          reattemptRequests: (room.reattemptRequests || []).filter((r) => r.status === 'pending'),
        });
      } catch (err) {
        console.error('Socket admin:join-room error:', err.message);
      }
    });

    // ── Admin broadcasts "START QUIZ FOR ALL" ────────────────────────────────
    // Persists quizStarted=true in DB, then broadcasts room:quiz-started
    // to all sockets in the room (including students in the waiting lobby).
    socket.on('admin:start-quiz', async ({ roomCode, roomPassword }) => {
      try {
        if (!roomCode) return;
        const normalizedCode = roomCode.trim().toUpperCase();

        const room = await Room.findOne({ roomCode: normalizedCode });
        if (!room) {
          socket.emit('error:room', { message: 'Room not found' });
          return;
        }
        if (room.roomPassword !== roomPassword) {
          socket.emit('error:room', { message: 'Invalid room password for start-quiz' });
          return;
        }

        // Persist started state to DB so late-joining students also get it
        await Room.updateOne({ roomCode: normalizedCode }, { $set: { quizStarted: true } });

        console.log(`[Socket] Admin started quiz for room: ${normalizedCode}`);

        // Broadcast to ALL sockets in this room (admin + all students)
        io.to(`room:${normalizedCode}`).emit('room:quiz-started', {
          roomCode: normalizedCode,
          startedAt: new Date().toISOString(),
          levelTimers: Array.isArray(room.levelTimers) ? room.levelTimers : [],
        });
      } catch (err) {
        console.error('Socket admin:start-quiz error:', err.message);
      }
    });

    // Student joins the room socket session
    socket.on('student:join-room', async ({ roomCode, student }) => {
      try {
        if (!roomCode || !student?.mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        socket.join(`room:${normalizedCode}`);

        // Check if quiz has already been started by admin (late joiner catch-up)
        const room = await Room.findOne({ roomCode: normalizedCode }).select('quizStarted levelTimers status participants').lean();
        if (room?.quizStarted) {
          // Immediately tell this student the quiz has started (they missed the broadcast)
          socket.emit('room:quiz-started', {
            roomCode: normalizedCode,
            startedAt: new Date().toISOString(),
            levelTimers: Array.isArray(room.levelTimers) ? room.levelTimers : [],
          });
        }

        const cleanMobile = String(student.mobile).replace(/\D/g, '').slice(-10);
        const existingP = (room?.participants || []).find(
          (p) => String(p.mobile || '').replace(/\D/g, '').slice(-10) === cleanMobile
        );

        // Notify admin in this room with current progress if rejoining
        io.to(`room:${normalizedCode}`).emit('student:joined', {
          mobile: cleanMobile,
          name: student.name || existingP?.name || 'Student',
          branch: student.branch || existingP?.branch || 'CSE',
          level: existingP?.level || student.currentLevel || 1,
          score: existingP?.score || 0,
          timeTaken: existingP?.timeTaken || 0,
          status: existingP?.status || student.status || 'in-progress',
          isDisqualified: Boolean(existingP?.isDisqualified),
          levels: existingP?.levels || [],
          joinedAt: existingP?.joinedAt || new Date(),
        });
      } catch (err) {
        console.error('Socket student:join-room error:', err.message);
      }
    });

    // Student emits live progress update (level up, score change, completion, etc.)
    socket.on('student:progress', async ({ roomCode, mobile, level, currentLevel, score, timeTaken, status, isDisqualified }) => {
      try {
        if (!roomCode || !mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
        const actualLevel = level ?? currentLevel ?? 1;

        const Student = require('../models/Student');
        const student = await Student.findOne({ mobile: cleanMobile }).select('name branch levels attemptHistory totalScore totalTimeTaken status').lean();
        let levels = [];
        if (student) {
          if (Array.isArray(student.levels) && student.levels.length > 0) {
            levels = student.levels.map((lvl) => ({
              level: lvl.level,
              score: lvl.score || 0,
              timeTaken: lvl.timeTaken || 0,
            }));
          } else if (Array.isArray(student.attemptHistory) && student.attemptHistory.length > 0) {
            const matched = [...student.attemptHistory].reverse().find((a) => a.roomCode === normalizedCode);
            if (matched && Array.isArray(matched.levelsSummary)) {
              levels = matched.levelsSummary.map((lvl) => ({
                level: lvl.level,
                score: lvl.score || 0,
                timeTaken: lvl.timeTaken || 0,
              }));
            }
          }
        }

        const computedTotalScore = levels.length > 0
          ? levels.reduce((acc, curr) => acc + (curr.score || 0), 0)
          : (score ?? student?.totalScore ?? 0);

        const computedTotalTime = levels.length > 0
          ? levels.reduce((acc, curr) => acc + (curr.timeTaken || 0), 0)
          : (timeTaken ?? student?.totalTimeTaken ?? 0);

        const finalStatus = status || student?.status || 'in-progress';

        // Broadcast to admin room immediately
        io.to(`room:${normalizedCode}`).emit('student:updated', {
          mobile: cleanMobile,
          name: student?.name,
          branch: student?.branch,
          level: actualLevel,
          score: computedTotalScore,
          timeTaken: computedTotalTime,
          status: finalStatus,
          isDisqualified: Boolean(isDisqualified),
          levels,
          lastActive: new Date(),
        });

        // Persist update in Room document
        const updateResult = await Room.updateOne(
          {
            roomCode: normalizedCode,
            $or: [
              { 'participants.mobile': cleanMobile },
              { 'participants.mobile': mobile },
            ],
          },
          {
            $set: {
              'participants.$.level': actualLevel,
              'participants.$.score': computedTotalScore,
              'participants.$.timeTaken': computedTotalTime,
              'participants.$.status': finalStatus,
              'participants.$.isDisqualified': Boolean(isDisqualified),
              'participants.$.levels': levels,
              'participants.$.lastActive': new Date(),
            },
          }
        );

        // If participant record wasn't present in Room yet, push them
        if (updateResult.matchedCount === 0) {
          await Room.updateOne(
            { roomCode: normalizedCode },
            {
              $push: {
                participants: {
                  mobile: cleanMobile,
                  name: student?.name || 'Student',
                  branch: student?.branch || 'CSE',
                  level: actualLevel,
                  score: computedTotalScore,
                  timeTaken: computedTotalTime,
                  status: finalStatus,
                  isDisqualified: Boolean(isDisqualified),
                  levels,
                  joinedAt: new Date(),
                  lastActive: new Date(),
                },
              },
            }
          );
        }
      } catch (err) {
        console.error('Socket student:progress error:', err.message);
      }
    });

    // Disqualification notification
    socket.on('student:disqualified', async ({ roomCode, mobile }) => {
      try {
        if (!roomCode || !mobile) return;
        const normalizedCode = roomCode.trim().toUpperCase();
        const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);

        io.to(`room:${normalizedCode}`).emit('student:disqualified', { mobile: cleanMobile });

        await Room.updateOne(
          {
            roomCode: normalizedCode,
            $or: [
              { 'participants.mobile': cleanMobile },
              { 'participants.mobile': mobile },
            ],
          },
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

        const room = await Room.findOne({ roomCode: normalizedCode });
        if (room) {
          const enriched = await Room.enrichParticipantsWithLevels(room.participants || [], normalizedCode);
          room.participants = enriched.map((p) => ({
            mobile: p.mobile,
            name: p.name,
            branch: p.branch,
            level: p.level || 1,
            score: p.score ?? p.computedTotalScore ?? 0,
            timeTaken: p.timeTaken ?? p.computedTotalTime ?? 0,
            status: p.status || 'in-progress',
            isDisqualified: Boolean(p.isDisqualified),
            isReattempt: Boolean(p.isReattempt),
            previousAttempt: p.previousAttempt || null,
            attempts: Array.isArray(p.attempts) ? p.attempts : [],
            levels: Array.isArray(p.levels) ? p.levels : [],
            joinedAt: p.joinedAt || new Date(),
            lastActive: p.lastActive || new Date(),
          }));
          room.status = 'closed';
          await room.save();
        }

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
