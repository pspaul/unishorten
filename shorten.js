async function fetchTable() {
    const response = await fetch('http://www.unicode.org/Public/idna/latest/IdnaMappingTable.txt');
    return response.text();
}

function int2unicode(i) {
    return String.fromCodePoint(i);
}

function code2unicode(code) {
    return int2unicode(parseInt(code, 16));
}

function parseTable(table) {
    // split and strip header
    const lines = table.split('\n').slice(11);
    
    const entries = Object.create(null);
    for (const line of lines) {
        const match = /^([0-9A-F]{4,}(?:\.\.[0-9A-F]{4,})?)\s+;\s+([^;#]+?)\s+(?:;((?: [0-9A-F]{4,})+)\s+)?#.+$/.exec(line);
        if (!match) {
            continue;
        }

        const charDescriptor = match[1];
        const state = match[2].trim();

        if (state !== 'mapped') {
            continue;
        }

        let chars = [];
        if (charDescriptor.includes('..')) {
            const [start, end] = charDescriptor.split('..').map(s => parseInt(s, 16));
            for (let i = start; i <= end; i++) {
                chars.push(int2unicode(i));
            }
        } else {
            chars.push(code2unicode(charDescriptor));
        }

        const mapping = match[2].trim().split(' ');
        for (const char of chars) {
            entries[char] = mapping.map(code2unicode).join('');
        }
    }

    return entries;
}

function createLookup(parsed) {
    const reverse = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
        if (value in reverse) {
            reverse[value].push(key);
        } else {
            reverse[value] = [key];
        }
    }

    return reverse;
}

function optimize(lookup) {
    const optimized = Object.create(null);
    for (const [long, shortcuts] of Object.entries(lookup)) {
        for (const shortcut of shortcuts) {
            if (shortcut.length < long.length) {
                if (!(long in optimized) || (shortcut.length < optimized[long][0].length)) {
                    // shortcut is the first or shorter
                    optimized[long] = [shortcut];
                } else if (shortcut.length === optimized[long][0].length) {
                    // shortcut is not longer than the previously found one
                    optimized[long].push(shortcut);
                }
            }
        }
    }
    return optimized;
}

class Node {
    constructor(value) {
        this.value = value;
        this.id = null;
    }
}

class DirectedAcyclicGraph {
    constructor() {
        this.nodes = [];
        this.edgesTo = new Map();
        this.edgesFrom = new Map();
    }
    addNode(value=null) {
        const node = new Node(value);
        this.nodes.push(node);
        node.id = this.nodes.length - 1;
        return node;
    }
    addEdge(nodeFrom, nodeTo) {
        if (this.edgesFrom.has(nodeFrom)) {
            this.edgesFrom.get(nodeFrom).push(nodeTo);
        } else {
            this.edgesFrom.set(nodeFrom, [nodeTo]);
        }
        
        if (this.edgesFrom.has(nodeTo)) {
            this.edgesTo.get(nodeTo).push(nodeFrom);
        } else {
            this.edgesTo.set(nodeTo, [nodeFrom]);
        }
    }
    predecessors(node) {
        if (!this.edgesTo.has(node)) {
            return [];
        }
        return [...this.edgesTo.get(node)];
    }
    successors(node) {
        if (!this.edgesFrom.has(node)) {
            return [];
        }
        return [...this.edgesFrom.get(node)];
    }
}

function shortenOptimal(lookup, string) {
    const g = new DirectedAcyclicGraph();
    
    // insert starting point
    const start = g.addNode();
    
    // insert all 'regular' nodes + edges
    const charNodes = [];
    let last = start;
    for (const char of string) {
        const n = g.addNode(char);
        charNodes.push(n);
        g.addEdge(last, n);
        last = n;
    }

    // insert destination point
    const end = g.addNode();
    g.addEdge(last, end);

    // insert all shortcuts
    for (const [long, shortcuts] of Object.entries(lookup)) {
        // select one of the possible shortest shortcuts
        const shortcut = shortcuts[0];
        const n = g.addNode(shortcut);

        // check all occurrences
        let startPos = 0;
        while (true) {
            startPos = string.indexOf(long, startPos);
            if (startPos === -1) {
                break;
            }

            // insert a shortcut
            const startNode = charNodes[startPos];
            const endNode = charNodes[startPos + long.length - 1];
            for (const fromNode of g.predecessors(startNode)) {
                for (const toNode of g.successors(endNode)) {
                    g.addEdge(fromNode, n);
                    g.addEdge(n, toNode);
                }
            }
            startPos += 1;
        }
    }

    // prepare
    const pred = { start: null };
    const dist = { start: 0 };

    // find shortest path
    const q = [start];
    while (q.length > 0) {
        const current = q.shift();

        for (const succ of g.successors(current)) {
            const distance = dist[current] + 1;
            if (succ in dist) {
                if (distance < dist[succ]) {
                    dist[succ] = distance;
                    pred[succ] = current;
                }
            } else {
                dist[succ] = distance;
                pred[succ] = current;
            }
            q.push(succ);
        }
    }

    // reconstruct path
    const path = [];
    let current = end;
    while (current !== null) {
        path.push(current);
        current = pred[current];
    }
    
    return path.slice(1, path.length - 1).reverse().map(n => n.value).join('');
}

async function shortenUrl(url) {
    const table = await fetchTable();
    const parsed = parseTable(table);
    const lookup = createLookup(parsed);
    const optimized = optimize(lookup);
    
    const shorteneDomain = shortenOptimal(optimized, new URL(url).hostname);
    const shortenedUrl = new URL(url);
    shortenedUrl.hostname = shorteneDomain;
    return shortenedUrl.toString();
}
