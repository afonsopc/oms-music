/**
 * Play recording accumulator (FR-62): forward deltas in (0,2) s only, the
 * min(30, duration/2) threshold, resets on song change and natural end,
 * jam songs and transfer seeds never record, scrubbing never inflates.
 */
import { describe, expect, it } from "bun:test";
import { toSongKey } from "@/domain/ids";
import { ListenAccumulator } from "../recording";
import { makeSong } from "./fakes";

const drive = (
  acc: ListenAccumulator,
  song: ReturnType<typeof makeSong>,
  from: number,
  to: number,
  step = 0.25,
  duration = song.duration,
): void => {
  for (let t = from; t <= to; t += step) acc.onTime(song, t, duration);
};

describe("ListenAccumulator", () => {
  it("records once after min(30, duration/2) of forward listening", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const song = makeSong(1, { duration: 200 });
    drive(acc, song, 0, 29.5);
    expect(recorded).toEqual([]);
    drive(acc, song, 29.5, 32);
    expect(recorded).toEqual([1]);
    drive(acc, song, 32, 90); // never records twice
    expect(recorded).toEqual([1]);
  });

  it("uses duration/2 for short songs", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const song = makeSong(2, { duration: 20 });
    drive(acc, song, 0, 9.5, 0.25, 20);
    expect(recorded).toEqual([]);
    drive(acc, song, 9.5, 11, 0.25, 20);
    expect(recorded).toEqual([2]);
  });

  it("scrubbing does not inflate plays (deltas outside (0,2) are ignored)", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const song = makeSong(3, { duration: 200 });
    acc.onTime(song, 0, 200);
    acc.onTime(song, 150, 200); // forward scrub: delta 150 ignored
    acc.onTime(song, 10, 200); // backward scrub: negative ignored
    drive(acc, song, 10, 20);
    expect(recorded).toEqual([]); // only ~10 s actually listened
  });

  it("resets on song change", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const a = makeSong(4, { duration: 200 });
    const b = makeSong(5, { duration: 200 });
    drive(acc, a, 0, 20);
    drive(acc, b, 0, 20); // switching resets: neither reaches 30
    expect(recorded).toEqual([]);
    drive(acc, b, 20, 35);
    expect(recorded).toEqual([5]);
  });

  it("natural end resets so a repeat play counts again", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const song = makeSong(6, { duration: 40 });
    drive(acc, song, 0, 25, 0.25, 40); // threshold 20 -> recorded
    expect(recorded).toEqual([6]);
    acc.resetOnEnded();
    drive(acc, song, 0, 25, 0.25, 40);
    expect(recorded).toEqual([6, 6]);
  });

  it("never records jam songs", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const jam = makeSong(7, { duration: 100, jam_song: true });
    drive(acc, jam, 0, 90);
    expect(recorded).toEqual([]);
  });

  it("transfer seeds are pre-marked and never double-record", () => {
    const recorded: number[] = [];
    const acc = new ListenAccumulator((id) => recorded.push(id));
    const song = makeSong(8, { duration: 200 });
    acc.markRecorded(toSongKey(8));
    drive(acc, song, 100, 190);
    expect(recorded).toEqual([]);
    acc.resetOnEnded(); // the NEXT full playthrough counts again
    drive(acc, song, 0, 35);
    expect(recorded).toEqual([8]);
  });
});
