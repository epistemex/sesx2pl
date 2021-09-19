#!/usr/bin/env node

/* *********************************************************
 *
 *  sesx2pl - Audition project to playlist (CUE, m3u)
 *
 *  Copyright (c) 2020 Epistemex
 *
 **********************************************************/

'use strict';

/*
  NOTE: Does not actually parse XML (sesx). It assumes "properly" formatted
  file as current default, i.e. most information on each line.
  If this changes in the future I might consider a proper XML parser, for now,
  this cover my own needs.
 */

const fs = require('fs');
const Path = require('path');

const log = console.log.bind(console);
const version = require('./package.json').version;

const options = require('commander')
  .usage('[options] <file.sesx> <outfile.(cue|m3u)>')
  .version(version, '-v')
  .description('Convert Audition sesx files to m3u or cue.')
  .option('-t,--track <list>', 'Include track(s) using comma separated index list (0-base).')
  .option('-s,--source <path>', 'Path to source audio for CUE file, substitute path for m3u.')
  .option('-d,--delta <sec>', 'Add delta for start point of a track.')
  .option('-i,--info', 'List key information about the sesx file.')
  .parse(process.argv);

log();

// ------- CHECKS -----------

const args = options.args;

if ( args.length < 2 ||
  Path.extname(args[ 0 ]).toLowerCase() !== '.sesx' ||
  (Path.extname(args[ 1 ]).toLowerCase() !== '.m3u' &&
    Path.extname(args[ 1 ]).toLowerCase() !== '.cue') ) return options.help();

let sesx;

try {
  sesx = fs.readFileSync(args[ 0 ], 'utf-8').split('\n');
}
catch(err) {
  return log('Could not open sesx infile.\n');
}

if (!sesx[0].trim().toLowerCase().startsWith('<?xml') && !sesx[1].trim().startsWith('<!DOCTYPE sesx>')) {
  return log('Not a valid Audition sesx file.\n');
}

// --------- PARSE ----------

const rxSampleRate = /sampleRate="(.*?)"/;
const rxTrackName = />(.*?)</;
const rxPath = /absolutePath="(.*?)"/;
const rxName = /name="(.*?)"/;
const rxId = /id="(.*?)"/;
const rxStartPoint = /startPoint="(.*?)"/;
const rxEndPoint = /endPoint="(.*?)"/;
const rxFileId = /fileID="(.*?)"/;

const tracks = [];
const files = [];
const playlist = [];

const delta = options.delta|0;

let sampleRate = 0;

let _track, _name = false;

sesx.forEach((line, i) => {
  line = line.trim();
  if (line.startsWith('<audioTrack ')) {
    _name = false;
    tracks.push(_track = {name: '', line: i, clips: []});
  }
  else if (!_name && line.startsWith('<name>')) {
    _name = true;
    _track.name = getRX(rxTrackName, line);
  }
  else if (_track && line.startsWith('<audioClip ')) _track.clips.push(i);
  else if (line.startsWith('<file ')) {
    let path = getRX(rxPath, line);
    let id = getRX(rxId, line) || null;
    if (path) files.push({path, id});
  }
  else if (line.startsWith('<session ')) sampleRate = +getRX(rxSampleRate, line);
});

if (!sampleRate) return log('Could not detect sample rate.');


// INFO ONLY?

if (options.info) {
  log('Audition sesx information:\n');
  log(`Number of tracks: ${ tracks.length } - (${ tracks.map(e => e.name).join(', ') })`);
  tracks.forEach((t, i) => {
    log(`  # of entries in track ${ i }: ${ t.clips.length }`);
  })
  return log();
}

// BUILD RAW PLAYLIST
(options.track || '0').split(',').map(e => e|0).forEach(t => {
  const track = tracks[t];
  if (!track) return log(`Project has no track ${ t }`);
  track.clips.forEach(i => {
    const line = sesx[i];
    const fileID = getRX(rxFileId, line);
    const startPoint = +getRX(rxStartPoint, line) / sampleRate;
    const endPoint = +getRX(rxEndPoint, line) / sampleRate;
    const duration = endPoint - startPoint;
    const path = getFilePathById(fileID);
    const name = getRX(rxName, line) || '';
    playlist.push({ startPoint, duration, path, name });
  })
})

playlist.sort((a, b) => a.startPoint - b.startPoint);

// PRODUCE FORMATTED PLAYLIST

const outfile = args[1];
let data;

if (Path.extname(outfile).toLowerCase() === '.cue') data = makeCue();
else if (Path.extname(outfile).toLowerCase() === '.m3u') data = makeM3U();

log(`Saving to: ${ outfile }`);

try {
  fs.writeFileSync(outfile, data, 'utf-8');
}
catch(err) {
  log('Error: Could not write to out file!');
}

log('Done.\n');

// ------- HELPERS --------------

function makeCue() {
  const src = Path.basename(options.source || 'INSERT-FILENAME-TO-SOURCE.mp3');
  const type = Path.extname(src).substr(1).toUpperCase();

  const data = ['PERFORMER "sesx2pl"', 'TITLE "Playlist"', `FILE "${ src }" ${ type }`];

  playlist.forEach((e, i) => {
    const parts = e.name.split(' - ').map(e => e ? e.trim() : '');
    const artist = parts[0];
    const title = parts[1];
    data.push(
      `  TRACK ${ (i + 1).toString().padStart(2, '0') } AUDIO`,
      `    TITLE "${ title.replace(/&amp;/g, '&')}"`,
      `    PERFORMER "${ artist.replace(/&amp;/g, '&')}"`,
      `    INDEX 01 ${ toCueTS(e.startPoint + delta )}`
      )
  })

  data.push('');
  return data.join('\r\n')
}

function makeM3U() {
  const data = ['#EXTM3U'];
  const subs = options.source;

  playlist.forEach(e => {
    const path = subs ? Path.join(subs, Path.win32.basename(e.path)) : e.path;
    data.push(`#EXTINF:${ e.duration|0 },e.name`, path)
  });

  data.push('');
  return data.join('\r\n')
}

function getFilePathById(id) {
  for(let f of files) if (f.id === id) return f.path;
  return null;
}

function toCueTS(t) {
  const min = ((t / 60)|0).toString();
  const sec = ((t % 60)|0).toString();
  return min.padStart(2, '0') + ':' + sec.padStart(2, '0') + ':00'
}

function getRX(rx, str) {
  const m = rx.exec(str);
  if (m) {
    if (m.index === rx.lastIndex) rx.lastIndex++;
    return m[1]
  }
}
