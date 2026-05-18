# Changelog

All notable changes to this project will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project follows [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### First cut

- Scaffolded Next.js 16 (App Router, Turbopack, Tailwind v4) project.
- Defined versioned `GraphDocument`, `GraphNode`, `GraphEdge` Zod schemas.
- Implemented Zustand store with add/remove/select/undo/redo and history.
- Locked first-cut catalogue to five services: Resource Group, App Service Plan,
  App Service, Storage Account, Key Vault.
- Wrote deterministic Terraform generator with topological ordering, naming
  utilities, and snapshot coverage of all five resource types.
- Mounted React Flow canvas, service palette, and Terraform output panel at the
  root canvas route.
