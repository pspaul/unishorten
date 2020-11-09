#!/usr/bin/env python3

import re
import sys
import requests
from urllib.parse import quote


def download_table():
    r = requests.get('http://www.unicode.org/Public/idna/latest/IdnaMappingTable.txt')
    return r.text


def read_table():
    # Source: http://www.unicode.org/Public/idna/latest/IdnaMappingTable.txt
    with open('IdnaMappingTable.txt', 'rb') as f:
        return f.read().decode('utf-8')


def int2unicode(i):
    return chr(i)


def code2unicode(code):
    return int2unicode(int(code, 16))


def parse_table(table):
    lines = table.split('\n')
    
    # strip header
    lines = lines[11:]

    entries = {}
    for line in lines:
        match = re.match(r'^([0-9A-F]{4,}(?:\.\.[0-9A-F]{4,})?)\s+;\s+([^;#]+?)\s+(?:;((?: [0-9A-F]{4,})+)\s+)?#.+$', line)
        if match is None:
            continue

        parts = match.groups()
        chars = parts[0]
        state = parts[1].strip()
        
        if state != 'mapped':
            continue

        if '..' in chars:
            start, end = [int(char, 16) for char in chars.split('..')]
            chars = []
            for code in range(start, end + 1):
                chars.append(int2unicode(code))
        else:
            chars = [code2unicode(chars)]

        mapping = parts[2].strip().split(' ')
        for char in chars:
            entries[char] = ''.join([code2unicode(code) for code in mapping])
    
    return entries


def create_lookup(parsed):
    reverse = {}
    for key, value in parsed.items():
        if value not in reverse:
            reverse[value] = []
        reverse[value].append(key)

    return reverse


def optimize(lookup):
    # remove 1:1 mappings
    optimized = {}
    for long, shortcuts in lookup.items():
        for shortcut in shortcuts:
            if len(shortcut) < len(long):
                if (long not in optimized) or (len(shortcut) < len(optimized[long][0])):
                    # shortcut is the first or shorter 
                    optimized[long] = [shortcut]
                elif len(shortcut) == len(optimized[long][0]):
                    # shortcut is not longer than the previously found one
                    optimized[long].append(shortcut)

    return optimized


class Node:
    def __init__(self, value):
        self.value = value
        self.id = None

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return self.id == other.id

    def __str__(self):
        return str((self.id, self.value))

    def __repr__(self):
        return self.__str__()


# Directed Acyclic Graph
class DAG:
    def __init__(self):
        self.nodes = []
        self.edges_to = {}
        self.edges_from = {}

    def add_node(self, value=None):
        node = Node(value)
        self.nodes.append(node)
        node.id = len(self.nodes) - 1
        return node

    def add_edge(self, node_from, node_to):
        if node_from not in self.edges_from:
            self.edges_from[node_from] = []
        self.edges_from[node_from].append(node_to)
        
        if node_to not in self.edges_to:
            self.edges_to[node_to] = []
        self.edges_to[node_to].append(node_from)

    def predecessors(self, node):
        if node in self.edges_to:
            return self.edges_to[node][:]
        else:
            return []

    def successors(self, node):
        if node in self.edges_from:
            return self.edges_from[node][:]
        else:
            return []


def shorten_optimal(lookup, string):
    # create graph
    g = DAG()

    # insert starting point
    start = g.add_node()

    # insert all 'regular' nodes + edges
    char_nodes = []
    last = start
    for char in string:
        n = g.add_node(char)
        char_nodes.append(n)
        g.add_edge(last, n)
        last = n

    # insert destination point
    end = g.add_node()
    g.add_edge(last, end)

    # insert all shortcuts
    for long, shortcuts in lookup.items():
        # select one of the possible shortest shortcuts
        shortcut = shortcuts[0]
        n = g.add_node(shortcut)

        # check all occurrences
        start_pos = 0
        while True:
            start_pos = string.find(long, start_pos)
            if start_pos == -1:
                break

            start_node = char_nodes[start_pos]
            end_node = char_nodes[start_pos + len(long) - 1]

            for from_node in g.predecessors(start_node):
                for to_node in g.successors(end_node):
                    g.add_edge(from_node, n)
                    g.add_edge(n, to_node)

            start_pos += 1
   
    # prepare
    pred = {start: None}
    dist = {start: 0}

    # find shortest path
    q = [start]
    while len(q) > 0:
        current = q.pop(0)
        print(current, q)

        for succ in g.successors(current):
            distance = dist[current] + 1
            if succ in dist:
                if distance < dist[succ]:
                    dist[succ] = distance
                    pred[succ] = current
            else:
                dist[succ] = distance
                pred[succ] = current

            q.append(succ)

    # reconstruct path
    path = []
    current = end
    while current is not None:
        path.insert(0, current)
        current = pred[current]

    return ''.join(n.value for n in path[1:-1])


def shorten_url(url):
    table = read_table()
    # table = download_table()
    parsed = parse_table(table)
    lookup = create_lookup(parsed)
    optimized = optimize(lookup)
    shortened = shorten_optimal(optimized, url)
    print('[*] Shortened from {} to {} chars!'.format(len(url), len(shortened)))
    print('[+] Result: ', shortened)
    print('[+] Encoded:', quote(shortened))


def main():
    if len(sys.argv) != 2:
        print('Usage: {} <url>'.format(sys.argv[0]))
        exit(1)

    url = sys.argv[1]
    shorten_url(url)


if __name__ == "__main__":
    main()
