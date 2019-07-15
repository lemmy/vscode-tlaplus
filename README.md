# TLA<sup>+</sup> for Visual Studio Code

This extension adds support for the [TLA<sup>+</sup> formal specification language](http://research.microsoft.com/en-us/um/people/lamport/tla/tla.html) to VS Code. It also supports running the TLC model checker on TLA<sup>+</sup> specifications.

## Features

- Powered by the [official TLA<sup>+</sup> toolbox](https://github.com/tlaplus/tlaplus).
- TLA<sup>+</sup> and PlusCal syntax highlighting and code snippets.
- Running the TLA<sup>+</sup>-to-PlusCal translator and module parser.
- Running TLC model checker on TLA<sup>+</sup> models.

## Requirements

In order to run various TLA<sup>+</sup> tools, you need Java 11 installed. If it's not your default Java SDK, configure the proper Java Home path in the extension settings.

## Commands

The extension provides the following commands in the Command Palette (only available when working with a .tla-file):

- `TLA+: Parse TLA+ module` for translating PlusCal to TLA<sup>+</sup> and checking syntax of the resulting specification.
- `TLA+: Check TLA+ model` for running the TLC model checker on the TLA<sup>+</sup> specification.

## License

[MIT](LICENSE)
