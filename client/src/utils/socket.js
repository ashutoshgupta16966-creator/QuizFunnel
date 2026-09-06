import { io } from 'socket.io-client';

let socket = null;

const SOCKET_SERVER_URL = import.meta.env.VITE_API_URL || 'https://quizfunnel-rqqp.onrender.com';

/**
 * Gets or initializes a singleton socket connection.
 * Only connects when explicitly called (e.g. for Room Quiz or Admin Dashboard).
 */
export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      autoConnect: false,
    });
  }
  return socket;
}

/**
 * Connects the socket if not already connected.
 */
export function connectSocket() {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

/**
 * Disconnects the socket completely.
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Admin joins room socket for real-time live monitoring.
 */
export function joinAdminRoomSocket(roomCode, roomPassword, { onJoined, onStudentJoined, onStudentUpdated, onStudentDisqualified, onError }) {
  const s = connectSocket();

  s.emit('admin:join-room', { roomCode, roomPassword });

  s.on('admin:joined-success', (data) => {
    if (onJoined) onJoined(data);
  });

  s.on('student:joined', (student) => {
    if (onStudentJoined) onStudentJoined(student);
  });

  s.on('student:updated', (data) => {
    if (onStudentUpdated) onStudentUpdated(data);
  });

  s.on('student:disqualified', (data) => {
    if (onStudentDisqualified) onStudentDisqualified(data);
  });

  s.on('error:room', (err) => {
    if (onError) onError(err);
  });

  return () => {
    s.off('admin:joined-success');
    s.off('student:joined');
    s.off('student:updated');
    s.off('student:disqualified');
    s.off('error:room');
  };
}

/**
 * Student joins room socket.
 */
export function joinStudentRoomSocket(roomCode, student, { onRoomClosed } = {}) {
  const s = connectSocket();

  s.emit('student:join-room', { roomCode, student });

  if (onRoomClosed) {
    s.on('room:closed', onRoomClosed);
  }

  return () => {
    if (onRoomClosed) s.off('room:closed');
  };
}

/**
 * Student emits live progress update to room.
 */
export function emitStudentProgress({ roomCode, mobile, level, score, timeTaken, status, isDisqualified }) {
  if (!roomCode || !mobile) return;
  const s = getSocket();
  if (s && s.connected) {
    s.emit('student:progress', {
      roomCode,
      mobile,
      level,
      score,
      timeTaken,
      status,
      isDisqualified: Boolean(isDisqualified),
    });
  }
}

/**
 * Student emits disqualification event.
 */
export function emitStudentDisqualified({ roomCode, mobile }) {
  if (!roomCode || !mobile) return;
  const s = getSocket();
  if (s && s.connected) {
    s.emit('student:disqualified', { roomCode, mobile });
  }
}
