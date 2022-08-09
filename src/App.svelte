<style>
	h1 {
		text-align: center;
	}
</style>
<script>
	import Timer from './Timer.svelte';
	import HowTo from './HowTo.svelte';
	let audio;
	let audio1;
	function appRunning(e) {
		audio1.play();
	}
	function timerEnds(e) {
		audio.play();

	}
</script>
<h1>Hand Washing App</h1>

<Timer on:end={timerEnds} on:running={appRunning}/>


<HowTo />

<a href="https://mixkit.co/free-sound-effects/applause/">Sound source</a>

<audio bind:this={audio}>
	<source src="sound.wav" />
</audio>

<audio bind:this={audio1}>
	<source src="sound1.wav" />
</audio>
