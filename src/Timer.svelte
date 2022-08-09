<script>
    import ProgressBar from './ProgressBar.svelte';
    const totalseconds = 20;
    let secondsleft = totalseconds;
    let isRunning = false;

    $: progress = ((totalseconds - secondsleft)/totalseconds)*100;
    function startTimer() {
        isRunning = true;
        const timer = setInterval(() => {
         secondsleft -= 1;
         if(secondsleft == 0){
            clearInterval(timer);
            isRunning = false; 
            secondsleft = totalseconds;
         }
    }, 1000)

    }

    
</script>
<style>
    h2 {
        margin : 0;
    }

    .start {
        background-color: blueviolet;
        width : 100%;
        margin : 10px 0;
    }

    .start[disabled] {
        background-color: rgb(194,194,194);
        cursor : not-allowed;
    }

</style>

<div bp="grid">
    <h2 bp="offset-5@md 4@md 12@sm">Seconds Left: {secondsleft}</h2>
</div>
<ProgressBar {progress} />

<div bp="grid" >
<button class="start" bp="offset-5@md 4@md 12@sm"  disabled={isRunning} on:click={startTimer}>Start</button>
</div>