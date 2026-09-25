import slots from "./slots.js";
import slotsMulti from "./slots-multi.js";
import slotsWheel from "./slots-wheel.js";
import roulette from "./roulette.js";
import blackjack from "./blackjack.js";
import horse from "./horse.js";
import crash from "./crash.js";
import arcade from "./arcade.js";
import frogger from "./frogger.js";
import memory from "./memory.js";
import chest from "./chest.js";
import revolver from "./revolver.js";
import holdem from "./holdem.js";

export const GAMES = [slots, slotsMulti, slotsWheel, roulette, blackjack, horse, crash, arcade, frogger, memory, chest, revolver, holdem];

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}
