// sexpr-dump: oracle for the TypeScript port of the NXSYS Lisp substrate.
// Walks a .trk file like NXSYS/rdtrkcmn.cpp (LoadExprcodeFile / InterpretTopLevelForm),
// printing one line per processed top-level form (see web/packages/core/src/lisp/dump.ts,
// which must produce byte-identical output).
#include "lisp.h"
#include "MessageBox.h"
#include "replace_filename.h"
#include <cstdio>
#include <cstring>
#include <string>

extern "C" void _Lisp_Uncodize_Sym_Hook(Sexpr*) {}

static void out(const std::string& s) {
    fwrite(s.data(), 1, s.size(), stdout);
    fputc('\n', stdout);
}

// Lisp barfs (MessageBoxA) become "BARF <msg>" lines, newlines escaped.
int MessageBox(void*, const char* message, const char*, int) {
    std::string m;
    for (const char* p = message; *p; p++) {
        if (*p == '\n') m += "\\n"; else m += *p;
    }
    out("BARF " + m);
    return 0;
}
int MessageBox(void* h, const std::string& m, const std::string& t, int f) {
    return MessageBox(h, m.c_str(), t.c_str(), f);
}

static Sexpr& symAND()   { static Sexpr s = intern("AND");   return s; }
static Sexpr& symOR()    { static Sexpr s = intern("OR");    return s; }
static Sexpr& symNOT()   { static Sexpr s = intern("NOT");   return s; }
static Sexpr& symLABEL() { static Sexpr s = intern("LABEL"); return s; }

static bool symcmp(Sexpr& s, const char* str) {
    return s.type == Lisp::ATOM && 0 == strcmp(s.u.a, str);
}

// Mirrors the macro-expansion decisions of relays.cpp CompileExpr.
static Sexpr walk(Sexpr s) {
    if (s.type != Lisp::tCONS) return s;
    Sexpr fn = CAR(s);
    if (fn == symAND() || fn == symOR()) {
        Sexpr head = CONS(fn, NIL), last = head;
        for (Sexpr r = CDR(s); CONSP(r); r = CDR(r)) {
            Sexpr c = CONS(walk(CAR(r)), NIL);
            CDR(last) = c;
            last = c;
        }
        return head;
    } else if (fn == symNOT()) {
        if (!CONSP(CDR(s))) return s;
        return CONS(fn, CONS(walk(CADR(s)), NIL));
    } else if (fn == symLABEL()) {
        Sexpr r = CDR(s);
        if (!CONSP(r) || !CONSP(CDR(r))) return s;
        Sexpr head = CONS(fn, CONS(CAR(r), NIL)), last = CDR(head);
        for (Sexpr b = CDR(r); CONSP(b); b = CDR(b)) {
            Sexpr c = CONS(walk(CAR(b)), NIL);
            CDR(last) = c;
            last = c;
        }
        return head;
    } else {
        Sexpr m = MaybeExpandMacro(s);
        if (m != EOFOBJ) return walk(m);
        return s;
    }
}

static int Interp(const std::string& fname, Sexpr s);

static bool LoadFile(const std::string& fname) {
    FILE* f = fopen(fname.c_str(), "r");
    if (!f) { out("ERROR cannot open " + fname); return false; }
    bool got_it = false, success = true;
    while (success && !got_it) {
        Sexpr s = read_sexp(f);
        if (s.type == Lisp::tNULL) {
            if (s == EOFOBJ) got_it = true;
            else { out("ERROR read error in " + fname); success = false; }
        } else
            success = Interp(fname, s);
    }
    fclose(f);
    return got_it;
}

static int LoadError(const char* msg, Sexpr s) {
    std::string m(msg);
    if (s != EOFOBJ) m += ": " + s.PRep();
    out("ERROR " + m);
    return 0;
}

static int Interp(const std::string& fname, Sexpr s) {
    out(s.PRep());
    if (s.type != Lisp::tCONS) return LoadError("Item definition not a list", s);
    Sexpr fn = CAR(s);
    if (fn.type != Lisp::ATOM) return LoadError("Top-level item doesn't start with atom", s);
    Sexpr f2 = MaybeExpandMacro(s);
    if (f2 != EOFOBJ) return Interp(fname, f2);
    else if (fn == DEFRMACRO) {
        Sexpr nm = (CDR(s).type == Lisp::tCONS) ? CADR(s) : NIL;
        int r = defrmacro(s);
        out(std::string(r == 1 ? "DEFRMACRO " : r == -1 ? "DEFRMACRO-DUP " : "DEFRMACRO-FAILED ") + nm.PRep());
        return 1;
    } else if (fn == FORMS) {
        SPop(s);
forms:
        while (s.type == Lisp::tCONS)
            if (!Interp(fname, SPopCar(s))) return 0;
        return 1;
    }
    Sexpr rest = CDR(s);
    if (symcmp(fn, "QUIT")) return 1;
    else if (symcmp(fn, "INCLUDE")) {
        if (!(CONSP(rest) && CADR(s).type == Lisp::STRING))
            return LoadError("Bad INCLUDE", s);
        return LoadFile(replace_filename(fname, CADR(s).u.s));
    } else if (symcmp(fn, "RELAY")) {
        if (CONSP(rest))
            out("EXPANDED " + walk(CONS(symAND(), CDR(rest))).PRep());
        return 1;
    } else if (symcmp(fn, "TIMER")) {
        if (CONSP(rest) && CONSP(CDR(rest)))
            out("EXPANDED " + walk(CONS(symAND(), CDR(CDR(rest)))).PRep());
        return 1;
    } else if (symcmp(fn, "ROUTE") || symcmp(fn, "MENU") || symcmp(fn, "COMMENT") || symcmp(fn, "LAYOUT"))
        return 1;
    else if (symcmp(fn, "EVAL-WHEN")) {
        SPop(s);
        if (s.type == Lisp::tCONS && CAR(s).type == Lisp::tCONS) {
            Sexpr sc = SPopCar(s);
            for (; sc.type == Lisp::tCONS; SPop(sc))
                if (CAR(sc).type == Lisp::ATOM && symcmp(CAR(sc), "EVAL"))
                    goto forms;
        }
        return 1;
    }
    return LoadError("Unknown top level form", fn);
}

int main(int argc, char** argv) {
    if (argc != 2) { fprintf(stderr, "usage: sexpr-dump main.trk\n"); return 2; }
    bool ok = LoadFile(argv[1]);
    return ok ? 0 : 1;
}
