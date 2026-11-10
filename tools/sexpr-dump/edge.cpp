// sexpr-edge: reads edge-case inputs (one per line, "@N" = newline) from stdin, runs
// read_sexp_from_char_string on each and prints CASE / BARF / VALUE / LEFT lines.
// Oracle for web/packages/core/test/reader.test.ts.
#include "lisp.h"
#include "MessageBox.h"
#include <cstdio>
#include <string>

extern "C" void _Lisp_Uncodize_Sym_Hook(Sexpr*) {}

static std::string esc(const std::string& s) {
    std::string r;
    for (char c : s) { if (c == '\n') r += "\\n"; else r += c; }
    return r;
}
int MessageBox(void*, const char* m, const char*, int) { printf("BARF %s\n", esc(m).c_str()); return 0; }
int MessageBox(void* h, const std::string& m, const std::string& t, int f) { return MessageBox(h, m.c_str(), t.c_str(), f); }

int main() {
    char line[8192];
    while (fgets(line, sizeof line, stdin)) {
        std::string s, u;
        for (char* p = line; *p && *p != '\n'; p++) s += *p;
        if (s.empty()) continue;
        for (size_t i = 0; i < s.size(); i++) {
            if (s[i] == '@' && i + 1 < s.size() && s[i + 1] == 'N') { u += '\n'; i++; }
            else u += s[i];
        }
        printf("CASE %s\n", s.c_str());
        int left = 0;
        Sexpr v = read_sexp_from_char_string(u.c_str(), &left);
        printf("VALUE %s\nLEFT %d\n", esc(v.PRep()).c_str(), left);
    }
}
