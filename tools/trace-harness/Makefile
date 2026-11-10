# Headless Linux build of the original NXSYS core for golden-trace generation.
ROOT := $(abspath ../..)
HERE := $(abspath .)
BUILD := $(HERE)/build
ifeq ($(origin CXX),default)
CXX := $(shell command -v clang++ >/dev/null 2>&1 && echo clang++ || echo g++)
endif

DEFS := -DNXSYSMac=1 -DNX_HEADLESS=1 -DREALLY_NXSYS=1 -DREDUCED_RATIONALS=1
INCS := -I$(HERE)/include -I$(ROOT)/NXSYSMac -I$(ROOT)/NXSYS/v2 -I$(ROOT)/NXSYS
CXXFLAGS := -include $(HERE)/include/nx_prelude.h -std=c++20 -O1 -g -w -fno-strict-aliasing -fpermissive $(DEFS) $(INCS)

CORE_NXSYS := HelpDirectory InterlockingLibrary NXGOLabel RelayLispSubstrate STLExtensions \
  demo fullsig ldgut lispmath lspmacro nxgo nxsys plight plight_apponly pswitch pugixml \
  rdtrkcmn readsexp relays rlyindex signal stop swkey text trafficlever traincmn trkgdi \
  turncomn txlayout
CORE_V2 := StatusReport SwitchConsistency joint tcircuit trackseg xexlight xsignal xstop \
  xtgload xtrains xturnout dynmenu
CORE_MAC := DumbStubs MacNxldwin MacRelayGraphics WinApiSTL

SRCS := $(addprefix $(ROOT)/NXSYS/,$(addsuffix .cpp,$(CORE_NXSYS))) \
        $(addprefix $(ROOT)/NXSYS/v2/,$(addsuffix .cpp,$(CORE_V2))) \
        $(addprefix $(ROOT)/NXSYSMac/,$(addsuffix .cpp,$(CORE_MAC))) \
        $(wildcard $(HERE)/src/*.cpp)

OBJS := $(patsubst $(ROOT)/%.cpp,$(BUILD)/obj/%.o,$(patsubst $(HERE)/src/%.cpp,$(ROOT)/tools/trace-harness/src/%.cpp,$(SRCS)))

all: $(BUILD)/nxtrace

$(BUILD)/nxtrace: $(OBJS)
	$(CXX) -o $@ $(OBJS) -Wl,--wrap=_Z10ReadLayoutPKc

$(BUILD)/obj/%.o: $(ROOT)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -MMD -MP -c $< -o $@

-include $(OBJS:.o=.d)

golden: all
	$(HERE)/make-golden.sh

clean:
	rm -rf $(BUILD)

.PHONY: all clean golden
