# Builds the sexpr-dump oracle from the real NXSYS Lisp substrate sources.
CXX ?= g++
SRC := ../../NXSYS
CXXFLAGS := -std=c++20 -O1 -g -w -DNXSYSMac=1 -include cstring -include cstdlib -include cstdio -Istub -I$(SRC)
OBJS := main.o readsexp.o RelayLispSubstrate.o lspmacro.o lispmath.o STLExtensions.o

all: sexpr-dump sexpr-edge

sexpr-dump: $(OBJS)
	$(CXX) -o $@ $(OBJS)

sexpr-edge: edge.o $(filter-out main.o,$(OBJS))
	$(CXX) -o $@ $^

edge.o: edge.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

main.o: main.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@
%.o: $(SRC)/%.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f sexpr-dump sexpr-edge *.o
