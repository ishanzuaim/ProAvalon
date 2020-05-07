import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
// import { RedisAdapter } from 'socket.io-redis';
import { transformAndValidate } from 'class-transformer-validator';

import { GamesService } from './games.service';
import {
  SocketEvents,
  JoinGame,
  LeaveGame,
  ChatResponse,
  ChatResponseType,
  ChatRequest,
} from '../../proto/lobbyProto';
import { SocketUser } from '../users/users.socket';
import RedisAdapter from '../redis-adapter/redis-adapter.service';
import { CommandsService } from '../commands/commands.service';

@WebSocketGateway()
export class GamesGateway {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(GamesGateway.name);

  constructor(
    // private redisAdapter: RedisAdapter,
    private gamesService: GamesService,
    private redisAdapter: RedisAdapter,
    private commandsService: CommandsService,
  ) {}

  async getSocketGameId(socket: SocketUser) {
    const gameRooms = (
      await this.redisAdapter.clientRooms(socket.id)
    ).filter((room) => room.includes('game'));

    return new Promise((resolve, reject) => {
      // Get the user's possible game rooms
      if (gameRooms.length !== 1) {
        this.logger
          .warn(`${socket.user.displayUsername} does not have a single joined \
            game. They are currently in: ${gameRooms}`);

        reject(
          new Error(
            `You are joined in ${gameRooms.length} rooms. Something went wrong!`,
          ),
        );
      }

      // socket.io-redis room name: 'game<id>'
      const room = gameRooms[0];
      const id = parseInt(room.replace('game', ''), 10);

      resolve(id);
    });
  }

  @SubscribeMessage(SocketEvents.GAME_CHAT_TO_SERVER)
  async handleGameChat(socket: SocketUser, chatRequest: ChatRequest) {
    if (chatRequest.text) {
      // Commands
      if (chatRequest.text[0] === '/') {
        this.commandsService.runCommand(chatRequest.text, socket);
        return undefined;
      }

      // Get the user's possible game rooms
      const gameRooms = (
        await this.redisAdapter.clientRooms(socket.id)
      ).filter((room) => room.includes('game'));

      if (gameRooms.length !== 1) {
        this.logger
          .warn(`${socket.user.displayUsername} does not have a single joined \
        game. They are currently in: ${gameRooms}`);

        return `You are joined in ${gameRooms.length} rooms. Something went wrong!`;
      }

      // socket.io-redis room name: 'game<id>'
      const room = gameRooms[0];
      const id = parseInt(room.replace('game', ''), 10);

      // Chat message
      this.logger.log(
        `Game ${id} chat message: ${socket.user.username}: ${chatRequest.text} `,
      );

      try {
        const chatResponse = await transformAndValidate(ChatResponse, {
          text: chatRequest.text,
          username: socket.user.displayUsername,
          timestamp: new Date(),
          type: ChatResponseType.CHAT,
        });

        this.gamesService.storeChat(id, chatResponse);

        this.server
          .to(room)
          .emit(SocketEvents.GAME_CHAT_TO_CLIENT, chatResponse);
      } catch (err) {
        this.logger.error('Validation failed. Error: ', err);
      }
    }
    return undefined;
  }

  @SubscribeMessage(SocketEvents.CREATE_GAME)
  async handleCreateGame(_socket: SocketUser) {
    return this.gamesService.createGame();
  }

  @SubscribeMessage(SocketEvents.JOIN_GAME)
  async handleJoinGame(socket: SocketUser, joinGame: JoinGame) {
    if (joinGame.id && this.gamesService.hasGame(joinGame.id)) {
      // Join the socket io room
      socket.join(`game${joinGame.id}`);

      this.logger.log(
        `${socket.user.displayUsername} has joined game ${joinGame.id}.`,
      );

      // Send message to users
      try {
        const chatResponse = await transformAndValidate(ChatResponse, {
          text: `${socket.user.displayUsername} has joined the room.`,
          username: socket.user.displayUsername,
          timestamp: new Date(),
          type: ChatResponseType.PLAYER_JOIN_GAME,
        });

        this.gamesService.storeChat(joinGame.id, chatResponse);

        this.server
          .to(`game${joinGame.id}`)
          .emit(SocketEvents.GAME_CHAT_TO_CLIENT, chatResponse);
      } catch (err) {
        this.logger.error('Validation failed. Error: ', err);
      }
      return 'OK';
    }
    return `Game ${joinGame.id} not found.`;
  }

  @SubscribeMessage(SocketEvents.LEAVE_GAME)
  async handleLeaveGame(socket: SocketUser, leaveGame: LeaveGame) {
    if (leaveGame.id && this.gamesService.hasGame(leaveGame.id)) {
      // Leave the socket io room
      socket.leave(`game${leaveGame.id}`);

      this.logger.log(
        `${socket.user.displayUsername} has left game ${leaveGame.id}.`,
      );

      // Send message to users
      try {
        const chatResponse = await transformAndValidate(ChatResponse, {
          text: `${socket.user.displayUsername} has left the room.`,
          username: socket.user.displayUsername,
          timestamp: new Date(),
          type: ChatResponseType.PLAYER_LEAVE_GAME,
        });

        this.gamesService.storeChat(leaveGame.id, chatResponse);

        this.server
          .to(`game${leaveGame.id}`)
          .emit(SocketEvents.GAME_CHAT_TO_CLIENT, chatResponse);
      } catch (err) {
        this.logger.error('Validation failed. Error: ', err);
      }
      return 'OK';
    }
    return `Game ${leaveGame.id} not found.`;
  }
}