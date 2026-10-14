# Glossary

- **Generation** — a per-note counter bumped on every local write, used to
  order writes without trusting clocks.
- **Slot** — one of the two files a note alternates between, so a torn write
  never destroys the last good copy.
