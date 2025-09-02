# Rewrite Assistant

A desktop application that helps authors rewrite scenes after manually reordering them in their manuscript. This is Phase 1 of the complete Rewrite Assistant vision, focusing on core scene reordering functionality.

## Features

### ✅ Phase 1 - Core Scene Reordering (COMPLETED)
- **Load Manuscripts**: Import text files and automatically parse them into scenes
- **Visual Scene Management**: View all scenes in a clean, organized interface
- **Drag-and-Drop Reordering**: Easily reorder scenes by dragging them to new positions
- **Scene Content Viewer**: View and read individual scene content
- **Undo/Redo Support**: Full undo/redo functionality with keyboard shortcuts (Ctrl+Z/Ctrl+Y)
- **Save Reordered Manuscripts**: Export your reordered manuscript as a text file
- **Move Tracking**: Visual indicators show which scenes have been moved from their original positions

### 🚧 Future Phases (Not Yet Implemented)
- **Phase 2**: Continuity Analysis - Identify issues when scenes are moved
- **Phase 3**: AI-Powered Rewriting - Generate scene rewrites for new positions
- **Phase 4**: Advanced Features - Polish and optimization

## Installation

### From Package (Recommended)
1. Download the packaged application from the `out/` directory
2. Extract the `Rewrite Assistant-win32-x64` folder
3. Run the `Rewrite Assistant` executable

### From Source
1. Clone or download this repository
2. Install dependencies: `npm install`
3. Run in development mode: `npm start`
4. Package for distribution: `npm run package`

## Usage

### Getting Started
1. **Launch the Application**: Open Rewrite Assistant
2. **Load a Manuscript**: Click "Load Manuscript" and select a `.txt` file
3. **View Scenes**: Your manuscript will be automatically parsed into scenes
4. **Reorder Scenes**: Drag scenes up or down to reorder them
5. **Save Changes**: Click "Save" to export your reordered manuscript

### Manuscript Format
The application supports text files with scenes separated by:
- Chapter markers (e.g., "Chapter 1", "CHAPTER 2")
- Scene markers (e.g., "Scene 1", "SCENE 2")
- Scene break markers (e.g., "### SCENE BREAK ###")
- Double newlines (automatic fallback)

### Keyboard Shortcuts
- **Ctrl+Z** (Cmd+Z on Mac): Undo last reorder
- **Ctrl+Y** (Cmd+Y on Mac): Redo last undone reorder
- **Ctrl+Shift+Z** (Cmd+Shift+Z on Mac): Alternative redo

### Interface Overview
- **Left Panel**: Scene list with drag-and-drop functionality
- **Right Panel**: Selected scene content viewer
- **Header**: File operations and undo/redo controls
- **Status Indicators**: Shows moved scenes and total scene count

## Technical Details

### Built With
- **Electron 32+**: Cross-platform desktop framework
- **React 18**: Modern UI framework
- **TypeScript 5+**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Zustand**: Lightweight state management
- **@atlaskit/pragmatic-drag-and-drop**: Smooth drag-and-drop interactions

### Architecture
- **Main Process**: File operations and system integration
- **Renderer Process**: React-based user interface
- **IPC Communication**: Secure communication between processes
- **State Management**: Centralized state with history tracking

### File Structure
```
src/
├── main/           # Electron main process
├── renderer/       # React application
│   ├── components/ # Reusable UI components
│   ├── features/   # Feature-specific components
│   ├── stores/     # State management
│   └── src/        # App entry point
└── shared/         # Shared types and constants
```

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Type checking
npm run lint

# Package for distribution
npm run package

# Create distributable installers
npm run make
```

### Project Structure
This project follows the strict guidelines outlined in the Rewrite Assistant Vision document:
- **NO** opening selection or optimization features
- **NO** automated scene ranking or scoring
- **FOCUS** on rewriting scenes for their new positions
- **TERMINOLOGY**: Uses "rewrite" not "optimize", "scenes" not "candidates"

## Sample Manuscript

A sample manuscript (`sample-manuscript.txt`) is included for testing. It contains 4 chapters that can be reordered to test the functionality.

## Troubleshooting

### Common Issues
1. **Application won't start**: Ensure all dependencies are installed with `npm install`
2. **Scenes not parsing correctly**: Check that your manuscript uses clear scene separators
3. **Drag-and-drop not working**: Try refreshing the application or reloading the manuscript
4. **Save not working**: Ensure you have write permissions to the target directory

### Getting Help
This is a development version. For issues or questions:
1. Check the console for error messages (F12 in development mode)
2. Verify your manuscript format matches the supported patterns
3. Try with the included sample manuscript first

## License

MIT License - See LICENSE file for details

## Roadmap

### Phase 2: Continuity Analysis
- Detect pronoun issues without antecedents
- Identify timeline conflicts
- Find missing character introductions
- Spot plot reference problems

### Phase 3: AI-Powered Rewriting
- Generate scene rewrites for new positions
- Address continuity issues automatically
- Preserve story elements while adapting context
- Diff view for reviewing changes

### Phase 4: Advanced Features
- Multiple manuscript support
- Advanced scene splitting options
- Export to various formats
- Performance optimizations

---

**Note**: This is Phase 1 of the complete Rewrite Assistant vision. The application currently focuses on scene reordering functionality. Future phases will add continuity analysis and AI-powered rewriting capabilities.

