/* plat_gl.h -- GL for the game code: OpenGL 3.3 core on desktop, WebGL2 (GLES 3.0) in the browser.
 *
 * Desktop resolves every entry point through SDL_GL_GetProcAddress into gpu/gl_api.c's table (no link
 * against opengl32 / libGL). Emscripten links its GLES3 bindings directly. Shaders are written once in
 * the subset both accept; plat_gl_shader() adds the version line at load time:
 *   desktop  "#version 330 core"
 *   browser  "#version 300 es" + default float precision (highp)
 */
#ifndef DIRGE_PLAT_GL_H
#define DIRGE_PLAT_GL_H

#ifdef __EMSCRIPTEN__
#include <GLES3/gl3.h>
#else
#include "gl_api.h"
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Compile + link a program from shared-subset sources. Returns 0 on failure (log on stderr). */
GLuint plat_gl_program(const char *vs_body, const char *fs_body);
/* The version header prepended to every shader on this target. */
const char *plat_gl_glsl_header(void);

#ifdef __cplusplus
}
#endif
#endif /* DIRGE_PLAT_GL_H */
