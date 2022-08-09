var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        if (value === null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/ProgressBar.svelte generated by Svelte v3.49.0 */

    function create_fragment$3(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let span;
    	let t0;
    	let t1;

    	return {
    		c() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			span = element("span");
    			t0 = text(/*progress*/ ctx[0]);
    			t1 = text("%");
    			attr(span, "class", "sr-only");
    			attr(div0, "class", "progress-bar svelte-1dna0l2");
    			set_style(div0, "width", /*progress*/ ctx[0] + "%");
    			attr(div1, "bp", "offset-5@md 4@md 12@sm");
    			attr(div1, "class", "progress-container svelte-1dna0l2");
    			attr(div2, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div1);
    			append(div1, div0);
    			append(div0, span);
    			append(span, t0);
    			append(span, t1);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*progress*/ 1) set_data(t0, /*progress*/ ctx[0]);

    			if (dirty & /*progress*/ 1) {
    				set_style(div0, "width", /*progress*/ ctx[0] + "%");
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div2);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { progress = 50 } = $$props;

    	$$self.$$set = $$props => {
    		if ('progress' in $$props) $$invalidate(0, progress = $$props.progress);
    	};

    	return [progress];
    }

    class ProgressBar extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$3, safe_not_equal, { progress: 0 });
    	}
    }

    /* src/Timer.svelte generated by Svelte v3.49.0 */

    function create_fragment$2(ctx) {
    	let div0;
    	let h2;
    	let t0;
    	let t1;
    	let t2;
    	let progressbar;
    	let t3;
    	let div1;
    	let button;
    	let t4;
    	let current;
    	let mounted;
    	let dispose;
    	progressbar = new ProgressBar({ props: { progress: /*progress*/ ctx[2] } });

    	return {
    		c() {
    			div0 = element("div");
    			h2 = element("h2");
    			t0 = text("Seconds Left: ");
    			t1 = text(/*secondsleft*/ ctx[0]);
    			t2 = space();
    			create_component(progressbar.$$.fragment);
    			t3 = space();
    			div1 = element("div");
    			button = element("button");
    			t4 = text("Start");
    			attr(h2, "bp", "offset-5@md 4@md 12@sm");
    			attr(h2, "class", "svelte-1f2n3w1");
    			attr(div0, "bp", "grid");
    			attr(button, "class", "start svelte-1f2n3w1");
    			attr(button, "bp", "offset-5@md 4@md 12@sm");
    			button.disabled = /*isRunning*/ ctx[1];
    			attr(div1, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div0, anchor);
    			append(div0, h2);
    			append(h2, t0);
    			append(h2, t1);
    			insert(target, t2, anchor);
    			mount_component(progressbar, target, anchor);
    			insert(target, t3, anchor);
    			insert(target, div1, anchor);
    			append(div1, button);
    			append(button, t4);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*startTimer*/ ctx[3]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*secondsleft*/ 1) set_data(t1, /*secondsleft*/ ctx[0]);
    			const progressbar_changes = {};
    			if (dirty & /*progress*/ 4) progressbar_changes.progress = /*progress*/ ctx[2];
    			progressbar.$set(progressbar_changes);

    			if (!current || dirty & /*isRunning*/ 2) {
    				button.disabled = /*isRunning*/ ctx[1];
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(progressbar.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(progressbar.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div0);
    			if (detaching) detach(t2);
    			destroy_component(progressbar, detaching);
    			if (detaching) detach(t3);
    			if (detaching) detach(div1);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    const totalseconds = 10;

    function instance$1($$self, $$props, $$invalidate) {
    	let progress;
    	let secondsleft = totalseconds;
    	let isRunning = false;
    	const dispatcher = createEventDispatcher();

    	function startTimer() {
    		$$invalidate(1, isRunning = true);

    		const timer = setInterval(
    			() => {
    				$$invalidate(0, secondsleft -= 1);
    				dispatcher('running');

    				if (secondsleft == 0) {
    					clearInterval(timer);
    					$$invalidate(1, isRunning = false);
    					$$invalidate(0, secondsleft = totalseconds);
    					dispatcher("end");
    				}
    			},
    			1000
    		);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*secondsleft*/ 1) {
    			$$invalidate(2, progress = (totalseconds - secondsleft) / totalseconds * 100);
    		}
    	};

    	return [secondsleft, isRunning, progress, startTimer];
    }

    class Timer extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$2, safe_not_equal, {});
    	}
    }

    /* src/HowTo.svelte generated by Svelte v3.49.0 */

    function create_fragment$1(ctx) {
    	let div;
    	let t0;
    	let h3;

    	return {
    		c() {
    			div = element("div");
    			div.innerHTML = `<img bp="offset-5@md 4@md 12@sm" src="Hand-washing-1.png" alt="How to Wash your Hands" class="svelte-1psfzlx"/>`;
    			t0 = space();
    			h3 = element("h3");
    			h3.innerHTML = `<a href="https://www.hey.nhs.uk/wp/wp-content/uploads/2017/01/Hand-washing-1.png">Picture Source</a>`;
    			attr(div, "bp", "grid");
    			attr(h3, "class", "svelte-1psfzlx");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			insert(target, t0, anchor);
    			insert(target, h3, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (detaching) detach(t0);
    			if (detaching) detach(h3);
    		}
    	};
    }

    class HowTo extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src/App.svelte generated by Svelte v3.49.0 */

    function create_fragment(ctx) {
    	let h1;
    	let t1;
    	let timer;
    	let t2;
    	let howto;
    	let t3;
    	let a;
    	let t5;
    	let audio0;
    	let t6;
    	let audio1_1;
    	let current;
    	timer = new Timer({});
    	timer.$on("end", /*timerEnds*/ ctx[3]);
    	timer.$on("running", /*appRunning*/ ctx[2]);
    	howto = new HowTo({});

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Hand Washing App";
    			t1 = space();
    			create_component(timer.$$.fragment);
    			t2 = space();
    			create_component(howto.$$.fragment);
    			t3 = space();
    			a = element("a");
    			a.textContent = "Sound source";
    			t5 = space();
    			audio0 = element("audio");
    			audio0.innerHTML = `<source src="sound.wav"/>`;
    			t6 = space();
    			audio1_1 = element("audio");
    			audio1_1.innerHTML = `<source src="sound1.wav"/>`;
    			attr(h1, "class", "svelte-1s5foe9");
    			attr(a, "href", "https://mixkit.co/free-sound-effects/applause/");
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			mount_component(timer, target, anchor);
    			insert(target, t2, anchor);
    			mount_component(howto, target, anchor);
    			insert(target, t3, anchor);
    			insert(target, a, anchor);
    			insert(target, t5, anchor);
    			insert(target, audio0, anchor);
    			/*audio0_binding*/ ctx[4](audio0);
    			insert(target, t6, anchor);
    			insert(target, audio1_1, anchor);
    			/*audio1_1_binding*/ ctx[5](audio1_1);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(timer.$$.fragment, local);
    			transition_in(howto.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(timer.$$.fragment, local);
    			transition_out(howto.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			destroy_component(timer, detaching);
    			if (detaching) detach(t2);
    			destroy_component(howto, detaching);
    			if (detaching) detach(t3);
    			if (detaching) detach(a);
    			if (detaching) detach(t5);
    			if (detaching) detach(audio0);
    			/*audio0_binding*/ ctx[4](null);
    			if (detaching) detach(t6);
    			if (detaching) detach(audio1_1);
    			/*audio1_1_binding*/ ctx[5](null);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let audio;
    	let audio1;

    	function appRunning(e) {
    		audio1.play();
    	}

    	function timerEnds(e) {
    		audio.play();
    	}

    	function audio0_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			audio = $$value;
    			$$invalidate(0, audio);
    		});
    	}

    	function audio1_1_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			audio1 = $$value;
    			$$invalidate(1, audio1);
    		});
    	}

    	return [audio, audio1, appRunning, timerEnds, audio0_binding, audio1_1_binding];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
