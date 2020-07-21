import { transformAndValidate } from '@proavalon/proto';
import { LobbySocketEvents, OnlinePlayer } from '@proavalon/proto/lobby';
import { store } from '../store';
import { setOnlinePlayers } from '../store/lobby/onlinePlayers/actions';

export const SetSocketPlayersEvents = (socket: SocketIOClient.Socket): void => {
  socket.on(
    LobbySocketEvents.ONLINE_PLAYERS,
    async (onlinePlayers: OnlinePlayer[]) => {
      try {
        const players = await transformAndValidate(OnlinePlayer, onlinePlayers);
        store.dispatch(setOnlinePlayers(players));
      } catch (err) {
        throw Error(`Validation failed. Error: ${err}`);
      }
    },
  );
};
