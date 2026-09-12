# Serial Lab

Serial debugging workbench for VSCode: protocols, waveform, terminal, export.

## Features (planned)

- Connect to a local serial port (default 115200 8N1)
- Built-in protocols: JustFloat, FireWater, RawData
- User-defined custom protocols
- Real-time multi-channel waveform (uPlot)
- Text / HEX terminal and send bar
- Export samples CSV and raw RX/TX log

## Development

```powershell
npm install
npm run compile
npm test
```

Press **F5** in VSCode to launch the Extension Development Host.

## License

MPL-2.0. See [LICENSE](LICENSE).

## Third-party

- [serialport](https://github.com/serialport/node-serialport) — MIT
- uPlot (planned) — MIT
- VSCode Extension API — proprietary to Microsoft; used under VS Code terms
