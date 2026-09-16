import slots from "./slots.js";
import slotsMulti from "./slots-multi.js";
import roulette from "./roulette.js";
import blackjack from "./blackjack.js";
import horse from "./horse.js";
import crash from "./crash.js";
import arcade from "./arcade.js";
import frogger from "./frogger.js";
import memory from "./memory.js";
import chest from "./chest.js";
import revolver from "./revolver.js";

export const GAMES = [slots, slotsMulti, roulette, blackjack, horse, crash, arcade, frogger, memory, chest, revolver];

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}
