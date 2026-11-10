// SimTimers.cpp -- deterministic replacement for NXSYSMac/NXTimers.mm.
//
// Same public semantics as NXTimers.mm (see timers.h), but built over a simulated
// integer-millisecond clock instead of NSTimer/gettimeofday:
//   * NXTimer(object, fn, ms) is one-shot; several timers may coexist for one object.
//   * KillOneTimer(object) kills every pending timer whose object matches.
//   * KillNXTimers() kills everything and resets the coders.
//   * RunTimers() clears HaltTimers' flag and then (TimeProcI) kills timers whose due
//     time is <= now, exactly as NXTimers.mm does.  HaltTimers() only sets the flag.
//   * Event order: earliest due time first; ties broken by scheduling order (seq).
//   * Callbacks run one at a time; sim time jumps to each event's due time.
// The Coder/FastCoder system is ported verbatim from NXTimers.mm.

#include "windows.h"
#include "timers.h"
#include <map>
#include <utility>
#include <vector>

// ------------------------------------------------------------------ sim clock
static long SimNowMs = 0;
static unsigned long long NextSeq = 1;

namespace {
struct Ev {
    void* object;
    NXTimerFn fn;
};
}
// key = (due time, sequence number) => earliest first, FIFO among equal due times.
static std::map<std::pair<long, unsigned long long>, Ev> Queue;
static bool TimersHalted = false;

long GetTickCount() { return SimNowMs; }

long SimNow() { return SimNowMs; }
bool SimHasPending() { return !Queue.empty(); }

// Run the single earliest event if it is due at or before 'limit_ms'.
// Sim time jumps to the event's due time.  Returns false if nothing was due.
bool SimStep(long limit_ms) {
    auto it = Queue.begin();
    if (it == Queue.end() || it->first.first > limit_ms)
        return false;
    long due = it->first.first;
    Ev ev = it->second;
    Queue.erase(it);
    if (due > SimNowMs)
        SimNowMs = due;
    ev.fn(ev.object);
    return true;
}

// Run all events due at or before 'until_ms', then leave the clock at until_ms.
void SimRunUntil(long until_ms) {
    while (SimStep(until_ms)) {}
    if (until_ms > SimNowMs)
        SimNowMs = until_ms;
}

void NXTimer(void* object, NXTimerFn fn, long ms) {
    Queue.emplace(std::make_pair(SimNowMs + ms, NextSeq++), Ev{object, fn});
}

void KillNXTimers() {
    Queue.clear();
    extern void SimResetCoders();
    SimResetCoders();
}

/* This is really "purge one Object from the timer system" */
void KillOneTimer(void* object) {
    for (auto it = Queue.begin(); it != Queue.end();) {
        if (it->second.object == object)
            it = Queue.erase(it);
        else
            ++it;
    }
}

void RunTimers() {
    TimersHalted = false;
    // TimeProcI: invalidate any timer already due (Time <= now).
    for (auto it = Queue.begin(); it != Queue.end();) {
        if (it->first.first <= SimNowMs)
            it = Queue.erase(it);
        else
            ++it;
    }
}

void HaltTimers() {
    TimersHalted = true;
}

// ------------------------------------------------------------------ Coders
// Verbatim from NXTimers.mm.

typedef bool BOOLE;

const int CodeBlipMS = 300;
const int FastCodeBlipMS = 120;

class Coder {
public:
    void* Object;
    CoderFn Function;
    short Valid;
    void Set(void*, CoderFn);
    void CallIfValid(BOOLE phase);
};

class CodersCtl {
public:
    int BlipMS;            /* must be first */
    int TimerRunning;
    int CodePhase;
    int NActive;
    std::vector<Coder> Coders;

public:
    CodersCtl(int BlipMS);
    void Reset();
    void TimerFn();
    void Register(void* object, CoderFn fn);
    void KillOne(void* object);
    void MaybeStartTimer();
};

CodersCtl::CodersCtl(int blip_ms) : Coders(100) {
    BlipMS = blip_ms;
    Reset();
}

static CodersCtl StdCoders(CodeBlipMS);
static CodersCtl FastCoders(FastCodeBlipMS);

void SimResetCoders() {
    StdCoders.Reset();
    FastCoders.Reset();
}

void CodersCtl::Reset() {
    Coders.clear();
    TimerRunning = CodePhase = NActive = 0;
}

void CoderTimerFn(void* coderctl) {
    ((CodersCtl*)coderctl)->TimerFn();
}

void CodersCtl::TimerFn() {
    CodePhase ^= 1;
    int p = CodePhase & 1;
    TimerRunning = 0;
    for (size_t i = 0; i < Coders.size(); i++)
        Coders[i].CallIfValid(p);
    if (NActive > 0)
        MaybeStartTimer();
}

void Coder::Set(void* the_object, CoderFn the_fn) {
    Object = the_object;
    Function = the_fn;
    Valid = 1;
}

void Coder::CallIfValid(BOOLE phase) {
    if (Valid)
        Function(Object, phase);
}

void CodersCtl::Register(void* object, CoderFn fn) {
    Coder* c = NULL;
    for (size_t i = 0; i < Coders.size(); i++) {
        if (!Coders[i].Valid) {
            c = &Coders[i];
            break;
        }
    }
    if (c == NULL) {
        Coder coder;
        Coders.push_back(coder);
        c = &(Coders[Coders.size() - 1]);
    }
    c->Set(object, fn);
    if (NActive++ == 0) {
        CodePhase = 0;
        MaybeStartTimer();
    }
    c->CallIfValid(CodePhase & 1);
}

void CodersCtl::MaybeStartTimer() {
    if (!TimerRunning) {
        NXTimer(this, CoderTimerFn, BlipMS);
        TimerRunning = 1;
    }
}

void NXCoder(void* object, CoderFn fn) {
    StdCoders.Register(object, fn);
}
void NXFastCoder(void* object, CoderFn fn) {
    FastCoders.Register(object, fn);
}

void CodersCtl::KillOne(void* data) {
    for (int i = (int)Coders.size() - 1; i >= 0; i--) {
        Coder& C = Coders[i];
        if (C.Valid && C.Object == data) {
            C.Valid = 0;
            if (i == Coders.size() - 1)
                Coders.resize(Coders.size() - 1);
            NActive--;
        }
    }
    if (NActive <= 0) {
        NActive = 0;            /* I don't know how this happens */
        /* (goes negative) but it does.. 18 January 1998*/
        TimerRunning = 0;
        KillOneTimer(this);
    }
}

void KillOneCoder(void* data) {
    StdCoders.KillOne(data);
}

void KillOneFastCoder(void* data) {    /* hey, not me!!! */
    FastCoders.KillOne(data);
}
